/**
 * 批量生成的持久化层：运行记录、逐条任务明细、材料装载、幂等落库。
 *
 * ## 这一层的三个职责，以及为什么它们不能被拆到 workflow 里
 *
 *   1. **运行与任务行**（`level_generation_run` / `level_generation_task`）
 *      是「可后台跑并观察进度」的唯一真源。workflow 的 step 只调回调，不写
 *      SQL —— 这样 workflow 在测试里可以配内存实现，不必连库。
 *   2. **材料装载**（知识点名 + 相关教材片段）是「知道去哪找教材」的知识，
 *      属于本仓库的内容模型（`chunks.micro_kp_id` + `chunk_kp_answer`）。
 *   3. **幂等落库**：确定性 levelId + `ON CONFLICT DO UPDATE`。这是验收②
 *      「重复执行不产生重复关卡」的落点。它必须和 `app.levels` 的写入约定
 *      （六列与 spec 一致）以及 `level_items` 的池词表映射（core→quiz）住在
 *      一起，否则会漂。
 *
 * ## 为什么不复用 `MarketService.save()`
 *
 * 看起来应该复用 —— 都是「把 spec 写进 levels + level_items」。但那条路径
 * 有三个市场语义的约束，对批量生成是错的：
 *
 *   - 它会 409 拒绝覆盖「非 saved 关卡」。批量生成要的正好是覆盖自己的旧产物。
 *   - 它写 `level_market` 行（把关卡标成「我保存的」）。AI 生成的关卡不该
 *     出现在「我保存的关卡」分区里 —— 那是票 14 的语义，票 16 是练习池。
 *   - 它跑 `MarketSaveLevelRequestSchema` 校验请求体。批量路径的输入是内部
 *     组装产物，不是 HTTP 请求。
 *
 * 共享的是真源（`validateLevelSpec`）和落表约定，不是那段代码。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { GenerationRun, GenerationRunListResponse, GenerationTask } from '@starmap/api-contract';
import type { LevelSpec } from '@starmap/shared';
import { DatabaseService } from '../db/database.service.js';
import type { QuestionMaterial } from './question-prompt.js';
import type { GenerationItemResult } from './generation.workflow.js';

/** `level_generation_run` 的一行 */
type RunRow = {
  id: string;
  status: string;
  requested_count: number;
  succeeded_count: number;
  failed_count: number;
  concurrency: number;
  note: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

/** `level_generation_task` 的一行（join 了知识点名与关卡标题） */
type TaskRow = {
  id: string;
  run_id: string;
  micro_kp_id: string;
  micro_kp_name: string | null;
  status: string;
  failure_kind: string | null;
  failure_message: string | null;
  failure_detail: unknown;
  level_id: string | null;
  level_title: string | null;
  item_count: number;
  attempts: number;
  started_at: string | null;
  finished_at: string | null;
};

/** 材料装载的行：一个知识点 + 它的一条教材片段 */
type MaterialRow = {
  micro_kp_id: string;
  micro_kp_name: string;
  chunk_id: string;
  chunk_text: string;
};

/**
 * 一次生成运行最多装载多少条教材片段。
 *
 * 不是越多越好：这道题只能引用一个 chunk（`sourceRef` 单选），给 30 条片段
 * 会稀释相关度（第一条的提示作用变弱），还会把提示词撑到几千 token。6 条
 * 是「够选出出处、又不淹没模型」的折中，与检索领域默认取 topN 的量级一致。
 */
const MATERIAL_CHUNK_LIMIT = 6;

/**
 * 一条片段至少要有这么多字符才值得喂给模型。
 *
 * 实测语料里有大量 3–10 字的碎片（公式残片、页码标签）。把它们当「教材
 * 片段」会让模型编出一道没有依据的题，然后 `sourceRef` 指向一个只有
 * `第 34 页` 的 chunk —— 结构合法但语义上是死链。
 */
const MATERIAL_MIN_CHUNK_CHARS = 40;

@Injectable()
export class GenerationService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  // ── 运行记录 ────────────────────────────────────────────────────────────

  /**
   * 建一次运行 + 建齐全部任务明细，在**一个事务**里。
   *
   * 为什么明细要在开始时一次建齐（而不是边跑边插）：
   *
   *   - 「进度 3/8」的分母必须稳定。边跑边插会让分母在轮询过程中变化，
   *     前端看到的进度会跳。
   *   - 崩溃恢复要能回答「哪些还没跑」。明细不在的话，重启后无法区分
   *     「还没轮到」和「一开始就没打算跑它」。
   */
  async createRun(input: {
    runId: string;
    microKpIds: readonly string[];
    concurrency: number;
    note?: string | null;
  }): Promise<void> {
    const client = await this.db.connection.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO level_generation_run
           (id, status, requested_count, succeeded_count, failed_count, concurrency, note, started_at)
         VALUES ($1, 'running', $2, 0, 0, $3, $4, now())`,
        [input.runId, input.microKpIds.length, input.concurrency, input.note ?? null],
      );

      for (const [index, microKpId] of input.microKpIds.entries()) {
        // 任务 id 由 runId + 顺序号决定，不用随机值：同一批重跑时任务行能被
        // 唯一索引 (run_id, micro_kp_id) 认出是同一件事，而不是新任务。
        await client.query(
          `INSERT INTO level_generation_task (id, run_id, micro_kp_id, status)
           VALUES ($1, $2, $3, 'pending')`,
          [`${input.runId}-t${String(index + 1).padStart(3, '0')}`, input.runId, microKpId],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 把一条任务的状态写成 workflow 回调的形态。
   *
   * `attempts` 每次进 `running` 自增 —— 这是分辨「一次就好」与「反复失败」
   * 的唯一手段。用它而不是加一张尝试历史表：一次批量里问「这条试了几次」
   * 只需要一个计数，加表会让明细查询多一次 join。
   */
  async markTask(update: {
    runId: string;
    microKpId: string;
    status: 'running' | 'succeeded' | 'failed';
    failureKind?: string | null;
    failureMessage?: string | null;
    failureDetail?: unknown;
    levelId?: string | null;
  }): Promise<void> {
    if (update.status === 'running') {
      await this.db.query(
        `UPDATE level_generation_task
            SET status = 'running', started_at = COALESCE(started_at, now()), attempts = attempts + 1
          WHERE run_id = $1 AND micro_kp_id = $2`,
        [update.runId, update.microKpId],
      );
      return;
    }

    await this.db.query(
      `UPDATE level_generation_task
          SET status = $3,
              failure_kind    = $4,
              failure_message = $5,
              failure_detail  = $6::jsonb,
              level_id        = COALESCE($7, level_id),
              finished_at     = now()
        WHERE run_id = $1 AND micro_kp_id = $2`,
      [
        update.runId,
        update.microKpId,
        update.status,
        update.failureKind ?? null,
        update.failureMessage ?? null,
        update.failureDetail === undefined || update.failureDetail === null
          ? null
          : JSON.stringify(update.failureDetail),
        update.levelId ?? null,
      ],
    );
  }

  /**
   * 收尾：按明细重算三个计数与最终状态。
   *
   * **不信任调用方传进来的计数**。崩在半路时（进程被杀，workflow 没走完）
   * 计数是脏的，而明细行是准的。从明细重算让「已经写成功的那些任务」不会
   * 因为收尾那一步没跑到而显示成 0。
   */
  async finishRun(runId: string, note?: string): Promise<void> {
    await this.db.query(
      `WITH counts AS (
         SELECT
           count(*) FILTER (WHERE status = 'succeeded') AS succeeded,
           count(*) FILTER (WHERE status = 'failed')    AS failed
           FROM level_generation_task
          WHERE run_id = $1
       )
       UPDATE level_generation_run r
          SET succeeded_count = c.succeeded,
              failed_count    = c.failed,
              status = CASE
                WHEN c.succeeded > 0 AND c.failed = 0 THEN 'succeeded'
                WHEN c.succeeded > 0 AND c.failed  > 0 THEN 'partial'
                ELSE 'failed'
              END,
              note = COALESCE($2, r.note),
              finished_at = now()
         FROM counts c
        WHERE r.id = $1`,
      [runId, note ?? null],
    );
  }

  /**
   * 把崩在半路的运行标成 failed。
   *
   * 服务启动时调一次。判据是「状态还是 running，但已经超过 stale 时限」——
   * 不按「状态还是 running」一刀切，因为可能真有别的实例在跑。
   */
  async reapStaleRuns(staleMinutes = 30): Promise<number> {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE level_generation_run
          SET status = 'failed',
              note = COALESCE(note, '') || ' [进程重启后判定为中断：没有任何实例在跑它]',
              finished_at = now()
        WHERE status = 'running'
          AND started_at < now() - ($1 || ' minutes')::interval
      RETURNING id`,
      [String(staleMinutes)],
    );
    return rows.length;
  }

  // ── 读取 ────────────────────────────────────────────────────────────────

  async getRun(runId: string): Promise<GenerationRun | null> {
    const runs = await this.db.query<RunRow>(
      `SELECT id, status, requested_count, succeeded_count, failed_count, concurrency,
              note, created_at, started_at, finished_at
         FROM level_generation_run
        WHERE id = $1`,
      [runId],
    );
    const run = runs[0];
    if (!run) return null;

    const tasks = await this.loadTasks(runId);

    return {
      runId: run.id,
      requestedCount: run.requested_count,
      succeededCount: run.succeeded_count,
      failedCount: run.failed_count,
      concurrency: run.concurrency,
      tasks,
      failures: summarizeFailures(tasks),
      createdAt: toIso(run.created_at),
      finishedAt: run.finished_at === null ? null : toIso(run.finished_at),
    };
  }

  async listRuns(limit = 20): Promise<GenerationRunListResponse> {
    const rows = await this.db.query<RunRow>(
      `SELECT id, status, requested_count, succeeded_count, failed_count, concurrency,
              note, created_at, started_at, finished_at
         FROM level_generation_run
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit],
    );
    return {
      items: rows.map((r) => ({
        runId: r.id,
        status: r.status as GenerationRunListResponse['items'][number]['status'],
        requestedCount: r.requested_count,
        succeededCount: r.succeeded_count,
        failedCount: r.failed_count,
        createdAt: toIso(r.created_at),
        finishedAt: r.finished_at === null ? null : toIso(r.finished_at),
      })),
    };
  }

  /**
   * 明细 + 关卡标题 + 知识点名。
   *
   * 三张表 LEFT JOIN 而不是分三次查：明细最多 50 行，一次 join 比三轮往返快，
   * 也避免「查完明细再查标题」之间数据变动的窗口。
   */
  private async loadTasks(runId: string): Promise<GenerationTask[]> {
    const rows = await this.db.query<TaskRow>(
      `SELECT t.id, t.run_id, t.micro_kp_id,
              kp.name AS micro_kp_name,
              t.status, t.failure_kind, t.failure_message, t.failure_detail,
              t.level_id,
              lv.title AS level_title,
              (SELECT count(*)::int FROM level_items li WHERE li.level_id = t.level_id) AS item_count,
              t.attempts, t.started_at, t.finished_at
         FROM level_generation_task t
         LEFT JOIN knowledge_points kp ON kp.id = t.micro_kp_id
         LEFT JOIN levels lv ON lv.id = t.level_id
        WHERE t.run_id = $1
        ORDER BY t.id`,
      [runId],
    );

    return rows.map((r) => ({
      taskId: r.id,
      microKpId: r.micro_kp_id,
      microKpName: r.micro_kp_name ?? r.micro_kp_id,
      status: r.status as GenerationTask['status'],
      failureKind: r.failure_kind as GenerationTask['failureKind'],
      failureMessage: r.failure_message,
      failureDetail: r.failure_detail,
      levelId: r.level_id,
      levelTitle: r.level_title,
      itemCount: r.item_count,
      attempts: r.attempts,
      durationMs:
        r.started_at !== null && r.finished_at !== null
          ? Math.max(0, new Date(r.finished_at).getTime() - new Date(r.started_at).getTime())
          : null,
    }));
  }

  // ── 材料装载 ────────────────────────────────────────────────────────────

  /**
   * 取一个知识点的生成材料。
   *
   * 教材片段的来源是 `chunks.micro_kp_id`（直接归属）而不是递归子树：一道
   * AI 练习题要考的是这个具体知识点，取父节点或兄弟节点的内容会生成一道
   * 「考别处」的题，而 `sourceRef` 指向的片段在播放器里点开也对不上。
   *
   * `kind = 'text'` 优先、`formula` 次之：图形片段（`figure`）的 text 往往是
   * 图注（`图 2.1.3 与门符号`），据此出题会要求学习者描述一张他看不到的图。
   * 但公式片段照样能作为出处 —— 一道纯公式题（`A + A·B = ?`）是合法的。
   */
  async loadMaterial(microKpId: string): Promise<QuestionMaterial | null> {
    const rows = await this.db.query<MaterialRow>(
      `SELECT kp.id AS micro_kp_id, kp.name AS micro_kp_name, c.id AS chunk_id, c.text AS chunk_text
         FROM knowledge_points kp
         JOIN chunks c ON c.micro_kp_id = kp.id
        WHERE kp.id = $1
          AND c.kind IN ('text', 'formula')
          AND length(c.text) >= $2
        ORDER BY CASE c.kind WHEN 'text' THEN 0 ELSE 1 END, c.ordinal
        LIMIT $3`,
      [microKpId, MATERIAL_MIN_CHUNK_CHARS, MATERIAL_CHUNK_LIMIT],
    );

    const first = rows[0];
    if (!first) return null;

    return {
      microKpId: first.micro_kp_id,
      microKpName: first.micro_kp_name,
      excerpts: rows.map((r) => ({ chunkId: r.chunk_id, text: r.chunk_text })),
    };
  }

  /**
   * 自动挑选最该生成的知识点。
   *
   * 判据（按优先级）：
   *   1. 必须是叶子知识点 —— 非叶子是章节，给它出题等于给一章出一道单选题。
   *   2. 必须有**够长的文本片段** —— 否则必然 `ungrounded_source`，白跑一趟
   *      还烧一次模型配额。
   *   3. 还没有 AI 关卡排前面 —— 重跑时优先补空缺，而不是反复重做已有的。
   *   4. 已有 AI 关卡的最久没更新的排前面（让陈旧内容先更新）。
   *
   * 「多久没更新」用 `level_items.id` 排序做不到（那些 id 是确定性的，不随
   * 生成时间变）。这里用该知识点在 `level_generation_task` 里最近一次**成功**
   * 的时间 —— 那是真正记录了「上次生成是什么时候」的唯一地方。
   *
   * 用 `NOT EXISTS` 而不是 LEFT JOIN + IS NULL：后者在有多个关卡时会出重复行，
   * 得再加 DISTINCT，两种写法等价但前者读起来就是「不存在」。
   */
  async pickTargets(limit: number): Promise<string[]> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT kp.id
         FROM knowledge_points kp
        WHERE kp.is_leaf
          AND EXISTS (
                SELECT 1 FROM chunks c
                 WHERE c.micro_kp_id = kp.id
                   AND c.kind IN ('text', 'formula')
                   AND length(c.text) >= $2
              )
        ORDER BY
          (SELECT count(*) FROM levels lv
            WHERE lv.micro_kp_id = kp.id AND lv.id LIKE 'lv-ai-%') ASC,
          (SELECT max(t.finished_at) FROM level_generation_task t
            WHERE t.micro_kp_id = kp.id AND t.status = 'succeeded') ASC NULLS FIRST,
          kp.ordinal, kp.id
        LIMIT $1`,
      [limit, MATERIAL_MIN_CHUNK_CHARS],
    );
    return rows.map((r) => r.id);
  }

  // ── 幂等落库 ────────────────────────────────────────────────────────────

  /**
   * 把组装好的 spec 写进关卡库。
   *
   * **幂等的三个支点**：
   *
   *   1. id 是确定性的（`lv-ai-<microKpId>`），由 workflow 侧的
   *      `generatedLevelId()` 保证 —— 同一知识点永远同一个 id。
   *   2. `ON CONFLICT (id) DO UPDATE` —— 重复写入是更新，不是插入。
   *   3. `level_items` 先删后插 —— 新题集替换旧题集，删掉的题不留孤儿行。
   *
   * 三条都在同一个事务里：崩在中间不会出现「levels 更新了但题目还是旧的」。
   *
   * ## 为什么要写 `level_items`
   *
   * `attempts.item_id` 有外键指向 `level_items`。只把题写进 `spec` 会让
   * 「记录一次作答」无处落 —— 那张表是给作答记录用的（票 05 会写它）。
   * 与 `MarketService.save()` 保持同一套落表约定。
   */
  async persistSpec(spec: LevelSpec, microKpId: string): Promise<{ levelId: string }> {
    const levelId = spec.meta.id;
    const kind = spec.meta.type === 'teaching' ? 'teach' : 'quiz';

    const client = await this.db.connection.connect();
    try {
      await client.query('BEGIN');

      // ordinal 取该知识点现有最大 +1，但只在**首次插入**时算：
      // 覆盖已有 AI 关卡时保留原 ordinal，否则每次重跑都会把它往后挤，
      // 最终排到教学关卡后面（AI 练习题不该排在正式关卡之前，但也不该
      // 每次重跑就换位置）。
      await client.query(
        `INSERT INTO levels (id, micro_kp_id, title, kind, ordinal, spec)
         VALUES (
           $1, $2, $3, $4,
           COALESCE((SELECT max(ordinal) + 1 FROM levels WHERE micro_kp_id = $2), 0),
           $5::jsonb
         )
         ON CONFLICT (id) DO UPDATE SET
           micro_kp_id = EXCLUDED.micro_kp_id,
           title       = EXCLUDED.title,
           kind        = EXCLUDED.kind,
           spec        = EXCLUDED.spec`,
        [levelId, microKpId, spec.meta.title, kind, JSON.stringify(spec)],
      );

      await client.query(`DELETE FROM level_items WHERE level_id = $1`, [levelId]);
      for (const item of spec.items) {
        await client.query(
          `INSERT INTO level_items
             (id, level_id, stem, options, answer, explain_correct, explain_wrong,
              misconception_tags, source_ref, variant_group, pool)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8::text[], $9, $10, $11)`,
          [
            item.id,
            levelId,
            item.stem,
            JSON.stringify(item.options),
            JSON.stringify(item.answer),
            item.explainCorrect,
            item.explainWrong,
            item.misconceptionTags,
            item.sourceRef,
            item.variantGroup,
            // spec 的 'core' 落表写 'quiz' —— 0001_init 的 CHECK 只有 quiz/practice，
            // 而 level-dev 注释里也点明了这两个词表是同一件事的两种叫法。
            item.pool === 'practice' ? 'practice' : 'quiz',
          ],
        );
      }

      await client.query('COMMIT');
      return { levelId };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 把 workflow 的逐条结果折算成运行级收尾。
   *
   * 单独一个方法是为了让「跑完了要做什么」在一处可读：先写每条明细的最终
   * 状态，再从明细重算运行状态。分成两步而不是一步聚合，是因为崩溃恢复时
   * 明细可能已经写了、运行还没收尾 —— 那时 `finishRun()` 单独再跑一次就能
   * 补上。
   */
  async recordResults(runId: string, results: readonly GenerationItemResult[]): Promise<void> {
    for (const r of results) {
      await this.markTask({
        runId,
        microKpId: r.microKpId,
        status: r.ok ? 'succeeded' : 'failed',
        failureKind: r.failureKind,
        failureMessage: r.failureMessage,
        failureDetail: r.failureDetail,
        levelId: r.levelId,
      });
    }
    await this.finishRun(runId);
  }
}

/**
 * 把失败明细汇总成「这一批里每类失败几条 + 一条典型原文」。
 *
 * 这是验收⑤「可汇总查看」的落点。`sample` 取**最早那条**而不是最长或最短：
 * 最早的那条最接近「第一次出现这个问题时的原始现场」，后来同类失败常常是
 * 同一原因的重复。
 */
export function summarizeFailures(
  tasks: readonly GenerationTask[],
): GenerationRun['failures'] {
  const buckets = new Map<string, { count: number; sample: string }>();
  for (const task of tasks) {
    if (task.status !== 'failed' || task.failureKind === null) continue;
    const message = task.failureMessage ?? '（没有记录原因）';
    const existing = buckets.get(task.failureKind);
    if (existing) existing.count += 1;
    else buckets.set(task.failureKind, { count: 1, sample: message });
  }
  return [...buckets.entries()]
    .map(([kind, v]) => ({
      kind: kind as GenerationRun['failures'][number]['kind'],
      count: v.count,
      sample: v.sample,
    }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

/**
 * pg 的 timestamptz 出来是 Date 对象，契约要求 ISO 字符串。
 * 单独写一个是因为 `toISOString()` 在 Date 上会抛（非法日期），
 * 而这里的值来自 DB，理论上合法，但加一层防御比让路由 500 好。
 */
function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
