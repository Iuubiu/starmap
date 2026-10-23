import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type { KpGateProgress, KpProgressView, MasteryView, ProgressBoard } from '@starmap/api-contract';
import { KpProgressViewSchema } from '@starmap/api-contract';
import { MASTERY_MIN_ATTEMPTS, MASTERY_MIN_VARIANTS, deriveState, type MasterySnapshot } from '@starmap/engine';
import { DatabaseService } from '../db/database.service.js';
import { aggregateSnapshots, groupByMicroKp, snapshotOf } from './evidence.js';
import {
  findKnowledgePoint,
  loadBooks,
  loadCourseLayers,
  loadEvidence,
  loadLeafDescendants,
  loadLeafIndex,
  type Runner,
} from './repository.js';

/**
 * 掌握度的时间粒度：一天（UTC 日界）。
 *
 * ## 为什么不是毫秒
 *
 * `current` 按半衰期连续衰减，毫秒级的时间差会让同一个知识点在两次相邻请求
 * 里得到 0.8312… 与 0.8311… 两个数。界面上四舍五入后看不出差别，但它有两个
 * 真实代价：
 *
 * 1. **票 05 验收第 7 条要求「同一串作答输入输出确定可重复」**。如果评估时刻
 *    取自时钟，两次读就不是同一组输入，那条要求只能在单元测试里对
 *    `replayMastery` 断言，端到端永远测不了。
 * 2. 「刷新一下掉了 0.01%」是学习者真实会注意到的抖动，而它不带任何信息 ——
 *    半衰期以天计，一天之内的变化小于显示精度。
 *
 * 所以评估时刻统一截断到 UTC 日界。代价是「今天做的题，今天之内 current 不会
 * 衰减」—— 那正好也是我们想表达的：记忆衰减是按天发生的事。
 *
 * ---
 *
 * **别把这个边界和「用户看见的今天」合并。** 两个边界服务的是两件不同的事：
 *
 * - 本函数（UTC 日界）：算法内部的**回放**评估时刻。不能改 —— 改它会让同一串
 *   作答在不同机器/时区上回放出不同数字，直接破坏票 05 第 7 条。
 * - `config/display-timezone.ts`（`STARMAP_DISPLAY_TIMEZONE`）：人眼里的**日期
 *   分界**。必须可配，换部署时区只改配置。
 *
 * 反例（曾经的缺陷）：看板的「今天答了几题」为了「与回放同口径」用了 UTC 日界，
 * 结果在上海凌晨 0–8 点这 8 小时里，昨天下午的作答被算进今天。那个地方要的是
 * 「学生手机上的今天」，不是「回放用的评估时刻」。两者重叠只是巧合。
 */
export const MASTERY_TIME_GRANULARITY_MS = 86_400_000;

/** 把 ISO 时刻截断到 UTC 日界。坏时间戳原样返回（不猜）。
 *
 * 这是**回放**边界，不是「今天」边界。用户可见的日期分界在
 * `config/display-timezone.ts`（按 `STARMAP_DISPLAY_TIMEZONE`）。
 */
export function floorToGranularity(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(Math.floor(ms / MASTERY_TIME_GRANULARITY_MS) * MASTERY_TIME_GRANULARITY_MS).toISOString();
}

/**
 * 掌握度读路径。
 *
 * ## 为什么不读 `app.mastery` 里的 `current` 列
 *
 * 那一列记的是「上次作答那一刻的 current」。`current` 会随时间持续变小，
 * 昨天写下的 0.83 今天可能应该显示 0.79 —— 直接读列等于把「上次算的时候」
 * 当成「现在」。所以这里每次都从 `attempts` 重放：数据量是「一个知识点
 * 的作答历史」，通常几十行，代价可以忽略；换来的是**任何时刻读到的数都
 * 与此刻一致**，不会出现「刷新一下掉了两个百分点」这种无法解释的现象。
 *
 * `app.mastery` 行仍然要写（票 05 验收要求同事务更新），它服务于批量统计
 * 与出题计划；但不是展示的真源。
 *
 * ## 非叶节点
 *
 * `ADR-0004` 要求父节点颜色由叶子按证据量加权聚合，且**只读派生、不落库**。
 * 这里的实现是「递归取叶子 → 逐个重放 → 加权平均」，不写任何一行。
 */
@Injectable()
export class MasteryService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** 池上的执行器。读路径不开事务。 */
  private get runner(): Runner {
    return (sql, params) => this.db.query(sql, params ?? []);
  }

  /**
   * 数据库侧的当前时刻。
   *
   * 用库的 `now()` 而不是 Node 的 `Date.now()`：多实例部署时进程时钟可能
   * 差几秒，而「同一响应里的所有数字共享同一时刻」这件事不该取决于哪台机器
   * 接了这次请求。
   */
  async now(): Promise<string> {
    return this.db.now();
  }

  /**
   * 一个知识点的双字段掌握度。
   *
   * `evaluatedAt` 由调用方（控制器）传入，测试因此可以断言具体数值而不是
   * 「比刚才小一点」。生产路径传数据库的 `now()`，让同一响应里的所有数字
   * 共享同一个时刻。
   */
  async view(microKpId: string, evaluatedAt: string): Promise<MasteryView> {
    const at = floorToGranularity(evaluatedAt);
    const point = await findKnowledgePoint(this.runner, microKpId);
    if (!point) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `知识点不存在: ${microKpId}`,
      });
    }

    if (point.is_leaf) {
      const snapshot = await this.leafSnapshot(point.id, at);
      return this.toView(point.id, point.name, true, 0, snapshot);
    }

    const leafIds = await loadLeafDescendants(this.runner, point.id);
    const rows = await loadEvidence(this.runner, leafIds);
    const grouped = groupByMicroKp(rows);
    const snapshots: MasterySnapshot[] = leafIds.map((id) =>
      snapshotOf(grouped.get(id) ?? [], at),
    );
    const aggregate = aggregateSnapshots(snapshots);

    // 父节点的五态由聚合值派生，**不是**把孩子的 state 投票。投票会让
    // 「20 个孩子各做一次」看起来和「一个孩子做过 20 次」一样，而那两件事
    // 对「这一章学会了没有」的回答完全不同。
    const state = deriveState(aggregate.attemptCount, aggregate.evidenceSufficient, aggregate.current ?? 0);

    return {
      microKpId: point.id,
      name: point.name,
      isLeaf: false,
      state,
      achieved: aggregate.evidenceSufficient ? aggregate.achieved : null,
      current: aggregate.evidenceSufficient ? aggregate.current : null,
      attemptCount: aggregate.attemptCount,
      variantCount: aggregate.variantCount,
      evidenceSufficient: aggregate.evidenceSufficient,
      // 父节点没有单一半衰期：不同叶子可能事实/概念/综合混着。给 concept 的
      // 30 天只是「量级参考」，真正的衰减在每片叶子上各按各的算了。
      halfLifeDays: 30,
      lastEvidenceAt: null,
      aggregatedLeafCount: leafIds.length,
    };
  }

  /** 一个叶节点的快照。写路径在同一事务里也会调用它。 */
  async leafSnapshot(microKpId: string, evaluatedAt: string, run?: Runner): Promise<MasterySnapshot> {
    const runner = run ?? this.runner;
    const rows = await loadEvidence(runner, [microKpId]);
    return snapshotOf(groupByMicroKp(rows).get(microKpId) ?? [], evaluatedAt);
  }

  /**
   * 批量掌握度：一次回放多个**叶节点**。
   *
   * ## 为什么需要它，而不是在循环里调 `view()`
   *
   * `/api/v1/nodes` 默认 20 条、上限 200 条。逐个调 `view()` 是 2×N 次往返
   * （每个知识点一次 `findKnowledgePoint`、一次 `loadEvidence`），200 条就是
   * 400 次。这里把「取节点」「取证据」各收成一条 `= ANY($1)` 查询，**查询次数
   * 与 N 无关**。
   *
   * 这不是第二套算法：`loadEvidence` → `groupByMicroKp` → `snapshotOf`
   * 与 `view()` 逐字相同，只是把「取数」从每个节点一次改成一次取完。两边算出
   * 的数必须逐位相同——否则「列表里的百分比」与「详情页的百分比」又会分叉，
   * 那正是本次要消灭的那类缺陷。
   *
   * ## 为什么只收叶节点
   *
   * 非叶节点的读路径要递归取后代（`loadLeafDescendants`），每个节点的后代
   * 集合不同，无法与叶子共用同一次 `loadEvidence`。传进非叶 id 会直接抛错，
   * 而不是悄悄给一个「未学习」的假值——静默的错误答案比报错难查得多。
   * 需要非叶节点的聚合值请调 `view()`。
   *
   * ## 时刻
   *
   * `evaluatedAt` 由调用方传一次，内部截到 UTC 日界后给**所有**节点共用。
   * 在方法内部逐节点取时刻会让同一响应里的数字分属不同时刻，`current` 连续
   * 衰减，差几毫秒就差千分之一——列表里两个节点的百分比会互相不可比。
   */

  /**
   * 票 89：学习页右栏「本知识点进度」。
   *
   * 和三件事有关，所以放在服务端算：
   *
   * 1. **分母不能前端硬编码**。8 / 3 是引擎阈值（`MASTERY_MIN_ATTEMPTS` /
   *    `MASTERY_MIN_VARIANTS`），连对阈值是当前档位的 `consecutiveCorrect` ——
   *    改阈值只要改引擎，界面跟着变。
   * 2. **分子必须是本关的**。`view()` 的 `attemptCount` 是**累计作答**（474），
   *    拿它当分子就会出现「作答 474/8」。这里按关卡收窄，并在服务端饱和到阈值，
   *    真数留在 `cumulative` 里。
   * 3. **比例在服务端算**。「这条走了多少」是判定口径的一部分，客户端各自除法
   *    就会各自漂。
   */
  async kpProgress(
    microKpId: string,
    evaluatedAt: string,
    streakTarget: number,
  ): Promise<KpProgressView> {
    const point = await findKnowledgePoint(this.runner, microKpId);
    if (!point) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `知识点不存在: ${microKpId}` });
    }

    const levels = (await this.runner(
      `SELECT id, title FROM app.levels WHERE micro_kp_id = $1 ORDER BY ordinal DESC, id DESC LIMIT 1`,
      [microKpId],
    )) as { id: string; title: string }[];
    const level = levels[0] ?? null;

    const counters = (await this.runner(
      `SELECT
         count(*) FILTER (WHERE counts_toward_mastery)::int            AS counted,
         count(DISTINCT variant_group)
           FILTER (WHERE counts_toward_mastery)::int                   AS variants
       FROM app.attempts
       WHERE micro_kp_id = $1
         AND level_id IS NOT DISTINCT FROM $2::text`,
      [microKpId, level?.id ?? null],
    )) as { counted: number; variants: number }[];

    // 连对：从最新一条往前数连续答对的条数。答案本身不在这里算，只数布尔。
    const recent = (await this.runner(
      `SELECT correct FROM app.attempts
        WHERE micro_kp_id = $1
          AND level_id IS NOT DISTINCT FROM $2::text
        ORDER BY created_at DESC, id DESC
        LIMIT 200`,
      [microKpId, level?.id ?? null],
    )) as { correct: boolean }[];
    let streak = 0;
    for (const row of recent) {
      if (!row.correct) break;
      streak += 1;
    }

    const gate = (await this.runner(
      `SELECT payload, created_at FROM learning_log
        WHERE micro_kp_id = $1
          AND event LIKE 'gate!_%' ESCAPE '!'
          AND ($2::text IS NULL OR payload->>'levelId' = $2)
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [microKpId, level?.id ?? null],
    )) as { payload: unknown; created_at: Date | string }[];

    const gatePassed = readGatePassed(gate[0]?.payload);
    const gateEvaluatedAt = gate[0] ? toIso(gate[0].created_at) : null;

    const counted = counters[0]?.counted ?? 0;
    const variants = counters[0]?.variants ?? 0;
    const gates: KpGateProgress[] = [
      gateRow('attempts', '作答', counted, MASTERY_MIN_ATTEMPTS, '题'),
      gateRow('variants', '变式', variants, MASTERY_MIN_VARIANTS, '组'),
      gateRow('streak', '连对', streak, streakTarget, '题'),
    ];

    return KpProgressViewSchema.parse({
      microKpId: point.id,
      name: point.name,
      levelId: level?.id ?? null,
      levelTitle: level?.title ?? null,
      gates,
      gatePassed,
      gateEvaluatedAt,
      evaluatedAt,
    });
  }

  async viewMany(
    microKpIds: readonly string[],
    evaluatedAt: string,
  ): Promise<Map<string, MasteryView>> {
    const views = new Map<string, MasteryView>();
    if (microKpIds.length === 0) return views;

    const at = floorToGranularity(evaluatedAt);
    // 去重后再查：`limit=200` 里不会有重复 id，但接口是公开的，重复 id 不该
    // 变成两倍的工作量，也不该让 `groupByMicroKp` 之外的逻辑依赖入参唯一性。
    const ids = [...new Set(microKpIds)];

    const points = await this.db.query<{ id: string; name: string; is_leaf: boolean }>(
      `SELECT id, name, is_leaf FROM knowledge_points WHERE id = ANY($1::text[])`,
      [ids],
    );
    const byId = new Map(points.map((point) => [point.id, point]));

    const notLeaf = ids.filter((id) => byId.get(id)?.is_leaf === false);
    if (notLeaf.length > 0) {
      throw new Error(
        `viewMany 只接受叶节点：${notLeaf.join(', ')} 是折叠节点，它的聚合值请用 view()`,
      );
    }

    // 一次取完全部证据。这是「不随节点数增长」的落点：不再有任何按节点的查询。
    const evidence = await loadEvidence(this.runner, ids);
    const grouped = groupByMicroKp(evidence);

    for (const id of ids) {
      const point = byId.get(id);
      // 不存在的 id 不进结果（不是叶、也不是任何节点）。列表端点的 id 来自
      // `knowledge_points` 自己的查询，不会走到这里；公开调用则跳过比报错好：
      // 「查不到」与「查出未学习」是两件事，后者是编造事实。
      if (!point) continue;
      views.set(id, this.toView(id, point.name, true, 0, snapshotOf(grouped.get(id) ?? [], at)));
    }

    return views;
  }

  /**
   * 个人看板（票 80）：三块进度，共用一次回放与一个时刻。
   *
   * ## 为什么三块都在这里，而不是三个查询方法
   *
   * 「知识点掌握了 7 个」「八层加起来 6 个」这种自相矛盾，一旦出现，页面上的
   * 每个数字都会被怀疑。所以这里只回放一次（`viewMany`）、只取一次索引，
   * 三块分组都在同一份 `Map` 上做 —— 一致性是结构给的，不是靠调用方记得。
   *
   * ## 为什么层与书的分母不用 SQL 的 count
   *
   * 分母来自 `loadLeafIndex` 的同一批行。另写两条 `COUNT(*) GROUP BY` 当然也能
   * 算出同样的数，但那会多出两条与回放无关的计算路径；只要其中一条的 join
   * 条件略有不同（比如忘了 `is_leaf`），分子分母就会来自两个不同的总体。
   *
   * ## 时刻
   *
   * `floorToGranularity` 在 `viewMany` 里已经做过一次；这里显式再取一次，是为了
   * 把响应里的 `evaluatedAt` 与数字钉在同一个时刻上（而不是「差不多同一时刻」）。
   */
  async board(evaluatedAt: string): Promise<ProgressBoard> {
    const at = floorToGranularity(evaluatedAt);
    const leaves = await loadLeafIndex(this.runner);
    const views = await this.viewMany(leaves.map((leaf) => leaf.id), at);

    const stateOf = (id: string): string => views.get(id)?.state ?? 'unseen';

    const counts = {
      mastered: 0,
      proficient: 0,
      familiar: 0,
      attempted: 0,
      unseen: 0,
    };
    for (const leaf of leaves) {
      const state = stateOf(leaf.id) as keyof typeof counts;
      counts[state] += 1;
    }

    const total = leaves.length;
    const learning = counts.proficient + counts.familiar + counts.attempted;

    const layerRows = await loadCourseLayers(this.runner);
    const layers = layerRows.map((layer) => {
      const inLayer = leaves.filter((leaf) => leaf.course_layer_id === layer.id);
      return {
        id: layer.id,
        name: layer.name,
        ordinal: layer.ordinal,
        total: inLayer.length,
        mastered: inLayer.filter((leaf) => stateOf(leaf.id) === 'mastered').length,
      };
    });
    const layeredLeafCount = layers.reduce((sum, layer) => sum + layer.total, 0);

    const books = (await loadBooks(this.runner)).map((book) => {
      const inBook = leaves.filter((leaf) => leaf.source_id === book.id);
      return {
        id: book.id,
        title: book.title,
        enabled: book.enabled,
        total: inBook.length,
        // 「学过」= 有过作答证据且不在 unseen：刚接触也算学过，只是没掌握。
        learned: inBook.filter((leaf) => stateOf(leaf.id) !== 'unseen').length,
      };
    });

    return {
      evaluatedAt: at,
      knowledgePoints: {
        total,
        mastered: counts.mastered,
        learning,
        untouched: counts.unseen,
        byState: [
          { state: 'mastered', count: counts.mastered },
          { state: 'proficient', count: counts.proficient },
          { state: 'familiar', count: counts.familiar },
          { state: 'attempted', count: counts.attempted },
          { state: 'unseen', count: counts.unseen },
        ],
      },
      layers,
      books,
      unlayeredLeafCount: total - layeredLeafCount,
    };
  }

  /**
   * 快照 → 对外形状。
   *
   * 两个百分比只在证据充足时给出（`null` 否则）。这不是「前端记得处理 null」，
   * 而是**接口层不给数字**：spec.md:259 要求「低于门槛显示『证据不足』不给
   * 数字」，任何界面失误都不该有机会把 62.4% 摆到学习者眼前，让他据此决定
   * 要不要复习。
   */
  toView(
    microKpId: string,
    name: string,
    isLeaf: boolean,
    aggregatedLeafCount: number,
    snapshot: MasterySnapshot,
  ): MasteryView {
    const sufficient = snapshot.evidenceSufficient;
    return {
      microKpId,
      name,
      isLeaf,
      state: snapshot.state,
      achieved: sufficient ? snapshot.achieved : null,
      current: sufficient ? snapshot.current : null,
      attemptCount: snapshot.attemptCount,
      variantCount: snapshot.variantCount,
      evidenceSufficient: sufficient,
      halfLifeDays: snapshot.halfLifeDays,
      lastEvidenceAt: snapshot.lastEvidenceAt,
      aggregatedLeafCount,
    };
  }
}

/** 一条门槛：分子饱和到阈值，真数留在 cumulative 里。 */
function gateRow(
  key: KpGateProgress['key'],
  label: string,
  cumulative: number,
  target: number,
  unit: string,
): KpGateProgress {
  const value = Math.min(cumulative, target);
  return {
    key,
    label,
    value,
    cumulative,
    target,
    // 服务端算比例：前端不做除法（票 89 验收 2）
    ratio: target > 0 ? Number((value / target).toFixed(4)) : 0,
    reached: cumulative >= target,
    unit,
  };
}

/** 门控日志的 payload 里 `passed` 是布尔；老记录只有 `verdict`。 */
function readGatePassed(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as { passed?: unknown; verdict?: unknown };
  if (typeof record.passed === 'boolean') return record.passed;
  return record.verdict === 'passed';
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
