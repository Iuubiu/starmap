/**
 * 票 16 的持久化层测试：跑真实 Postgres。
 *
 * ## 为什么这一层必须连库而不是 mock
 *
 * 这张票的一半验收项是**数据库语义**，mock 掉 pg 就等于把被测物删了：
 *
 *   - 验收②「重复执行不产生重复关卡」靠 `ON CONFLICT (id) DO UPDATE` 与
 *     `DELETE`+`INSERT` 实现。用内存 Map 模拟只能证明我的 JS 逻辑自洽。
 *   - 验收④「AI 关卡只能进 practice 池」在库里有**触发器**兜底。触发器是
 *     plpgsql，只有真库能跑。
 *   - 幂等还牵扯 `level_items` 的孤儿行与 `attempts.item_id` 外键 —— 那是
 *     表结构约束，不是函数返回值的性质。
 *
 * 用的是全仓统一的 `createTestSchema()`：每次建一个 `app_test_*` schema，
 * 重放全部含 DDL 的迁移，结束删掉。**不写生产 schema**。
 *
 * ## 自种数据的前缀
 *
 * 所有 id 带 `gentest` 前缀，避开其他套件的固定断言（`lvtest`、`kp-noise`
 * 等）。测试之间也不共享知识点 —— 每个 `it` 自己种自己需要的。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../db/database.service.js';
import { LLM_PORT } from '../llm/llm.port.js';
import { ScriptedLlm } from '../llm/scripted-llm.js';
import type { INestApplication } from '@nestjs/common';
import { createTestSchema } from '../../test/test-schema.js';
import { GenerationService, summarizeFailures } from './generation.service.js';
import { assembleLevelSpec } from './level-assembly.js';
import type { GenerationTask } from '@starmap/api-contract';

/** 一段够长的中文解析，能过 checkLanguage 的 8 汉字下限 */
const EXPLAIN = '吸收律说的是：当一项被另一项完全包含时，被包含的那一项是多余的，可以直接去掉，剩下的就是被包含项。';

function question(chunkId: string) {
  return {
    stem: 'A + A·B 化简后等于什么？',
    options: ['A', 'B', 'A·B', 'A + B'],
    answer: 0,
    explainCorrect: `吸收律：A + A·B = A。${EXPLAIN}`,
    explainWrong: `这里把吸收律和分配律混了。${EXPLAIN}`,
    misconceptionTags: ['吸收律与分配律混淆'],
    sourceRef: chunkId,
    hintLadder: ['看看哪一项被另一项包含'],
  };
}

/** 种一个叶子知识点 + 够长的教材片段 */
async function seedKp(
  db: DatabaseService,
  microKpId: string,
  options: { chunkLength?: number; kind?: string; ordinal?: number; chunkCount?: number } = {},
): Promise<void> {
  await db.query(`INSERT INTO subjects (id, name) VALUES ('gentest-subj', '核电子学') ON CONFLICT DO NOTHING`);
  await db.query(
    `INSERT INTO modules (id, subject_id, name, tier)
     VALUES ('gentest-mod', 'gentest-subj', '数字逻辑', 'D') ON CONFLICT DO NOTHING`,
  );
  // sources 必须在前：chunks.source_id 有外键指向它
  await db.query(
    `INSERT INTO sources (id, title, kind) VALUES ('gentest-src', '康华光·电子技术基础', 'book')
     ON CONFLICT DO NOTHING`,
  );
  await db.query(
    `INSERT INTO knowledge_points (id, module_id, name, summary, is_leaf, depth, ordinal)
     VALUES ($1, 'gentest-mod', $2, '吸收律与德摩根律', true, 2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [microKpId, `知识点 ${microKpId}`, options.ordinal ?? 1],
  );
  const text = 'A + A·B = A，这是吸收律。'.repeat(8).slice(0, options.chunkLength ?? 120);
  // chunkCount 默认 1；传 0 表示「有知识点但没材料」，用来验证硬前置。
  // 单个 chunk 时 id 保持 `<kp>-chunk`（既有断言依赖它）；多 chunk 才带序号。
  const count = options.chunkCount ?? 1;
  for (let i = 0; i < count; i += 1) {
    const chunkId = count === 1 ? `${microKpId}-chunk` : `${microKpId}-chunk-${i}`;
    await db.query(
      `INSERT INTO chunks (id, source_id, ordinal, kind, text, page, micro_kp_id)
       VALUES ($1, 'gentest-src', $2, $3, $4, 34, $5) ON CONFLICT (id) DO NOTHING`,
      [chunkId, i + 1, options.kind ?? 'text', text, microKpId],
    );
  }
}

describe('GenerationService（连真实 Postgres）', () => {
  let schema: { name: string; drop: () => Promise<void> };
  let app: INestApplication;
  let db: DatabaseService;
  let service: GenerationService;

  beforeAll(async () => {
    schema = await createTestSchema();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PORT)
      .useValue(new ScriptedLlm([{ text: '假的' }]))
      .compile();
    app = moduleRef.createNestApplication();
    db = app.get(DatabaseService);
    await db.useSchema(schema.name);
    await app.init();
    service = new GenerationService(db);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await schema?.drop();
  });

  const specFor = (microKpId: string, chunkId: string) => {
    const assembled = assembleLevelSpec({
      microKpId,
      microKpName: `知识点 ${microKpId}`,
      questions: [question(chunkId)],
      levelId: `lv-ai-${microKpId}`,
    });
    if (!assembled.ok) throw new Error(`夹具组装失败：${assembled.message}`);
    return assembled.spec;
  };

  // ── 运行与任务行 ────────────────────────────────────────────────────────

  it('createRun 在一个事务里建好运行 + 全部明细，初始状态是 pending', async () => {
    await seedKp(db, 'gentest-run');
    await seedKp(db, 'gentest-run-b');
    await service.createRun({
      runId: 'gentest-run-1',
      microKpIds: ['gentest-run', 'gentest-run-b'],
      concurrency: 4,
    });

    const run = await service.getRun('gentest-run-1');
    expect(run).not.toBeNull();
    expect(run!.requestedCount).toBe(2);
    expect(run!.succeededCount).toBe(0);
    expect(run!.failedCount).toBe(0);
    expect(run!.concurrency).toBe(4);
    expect(run!.tasks).toHaveLength(2);
    expect(run!.tasks.every((t) => t.status === 'pending')).toBe(true);
    expect(run!.finishedAt).toBeNull();
  });

  it('markTask 的 running → succeeded 会记录 attempts 与耗时', async () => {
    await seedKp(db, 'gentest-mark');
    await service.createRun({ runId: 'gentest-run-2', microKpIds: ['gentest-mark'], concurrency: 1 });

    await service.markTask({ runId: 'gentest-run-2', microKpId: 'gentest-mark', status: 'running' });
    const midway = await service.getRun('gentest-run-2');
    expect(midway!.tasks[0]!.status).toBe('running');
    expect(midway!.tasks[0]!.attempts).toBe(1);

    // level_id 有外键指向 levels，所以先真的落一张关卡再引用它 ——
    // 这也更接近真实顺序（现实中 levelId 就是 persistSpec 刚刚返回的）
    const saved = await service.persistSpec(
      specFor('gentest-mark', 'gentest-mark-chunk'),
      'gentest-mark',
    );
    await service.markTask({
      runId: 'gentest-run-2',
      microKpId: 'gentest-mark',
      status: 'succeeded',
      levelId: saved.levelId,
    });
    const done = await service.getRun('gentest-run-2');
    expect(done!.tasks[0]!.status).toBe('succeeded');
    expect(done!.tasks[0]!.levelId).toBe('lv-ai-gentest-mark');
    // 关卡标题与题数从 join 里读出来，验证「明细能直接显示生成了什么」
    expect(done!.tasks[0]!.levelTitle).toContain('gentest-mark');
    expect(done!.tasks[0]!.itemCount).toBe(1);
    // started_at 被 running 那次写了，finished_at 被 succeeded 写了
    expect(done!.tasks[0]!.durationMs).not.toBeNull();
  });

  it('重复进 running 会累加 attempts（分辨「一次就好」与「反复失败」）', async () => {
    await seedKp(db, 'gentest-retry');
    await service.createRun({ runId: 'gentest-run-3', microKpIds: ['gentest-retry'], concurrency: 1 });

    for (let i = 0; i < 3; i += 1) {
      await service.markTask({ runId: 'gentest-run-3', microKpId: 'gentest-retry', status: 'running' });
    }
    const run = await service.getRun('gentest-run-3');
    expect(run!.tasks[0]!.attempts).toBe(3);
  });

  it('finishRun 从明细重算计数，不信调用方传的脏数字', async () => {
    // 两个知识点都要真的存在：level_generation_task.micro_kp_id 有外键
    await seedKp(db, 'gentest-ok');
    await seedKp(db, 'gentest-ok-b');
    await service.createRun({
      runId: 'gentest-run-4',
      microKpIds: ['gentest-ok', 'gentest-ok-b'],
      concurrency: 2,
    });

    await service.markTask({ runId: 'gentest-run-4', microKpId: 'gentest-ok', status: 'succeeded' });
    await service.markTask({
      runId: 'gentest-run-4',
      microKpId: 'gentest-ok-b',
      status: 'failed',
      failureKind: 'not_json',
      failureMessage: '模型没给 JSON',
    });

    await service.finishRun('gentest-run-4');

    const run = await service.getRun('gentest-run-4');
    expect(run!.succeededCount).toBe(1);
    expect(run!.failedCount).toBe(1);
    // 有成功有失败 → partial（不是 succeeded）
    const list = await service.listRuns(100);
    expect(list.items.find((i) => i.runId === 'gentest-run-4')!.status).toBe('partial');
    expect(run!.finishedAt).not.toBeNull();
  });

  it('全部失败 → failed 而不是 partial', async () => {
    await seedKp(db, 'gentest-allfail');
    await service.createRun({ runId: 'gentest-run-5', microKpIds: ['gentest-allfail'], concurrency: 1 });
    await service.markTask({
      runId: 'gentest-run-5',
      microKpId: 'gentest-allfail',
      status: 'failed',
      failureKind: 'llm_error',
      failureMessage: 'upstream 503',
    });
    await service.finishRun('gentest-run-5');

    const list = await service.listRuns(100);
    expect(list.items.find((i) => i.runId === 'gentest-run-5')!.status).toBe('failed');
  });

  // ── 幂等落库（验收②）──────────────────────────────────────────────────

  it('落库两次只产生一张关卡（重复执行不产生重复关卡）', async () => {
    await seedKp(db, 'gentest-idem');
    const spec = specFor('gentest-idem', 'gentest-idem-chunk');

    const first = await service.persistSpec(spec, 'gentest-idem');
    const second = await service.persistSpec(specspec(spec), 'gentest-idem');

    expect(first.levelId).toBe('lv-ai-gentest-idem');
    expect(second.levelId).toBe('lv-ai-gentest-idem');

    const levels = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM levels WHERE id = 'lv-ai-gentest-idem'`,
    );
    expect(Number(levels[0]!.n)).toBe(1);
  });

  it('覆盖落库时题目集被替换，不留下旧题的孤儿行', async () => {
    await seedKp(db, 'gentest-replace');
    const twoQuestions = assembleLevelSpec({
      microKpId: 'gentest-replace',
      microKpName: '知识点 gentest-replace',
      questions: [question('gentest-replace-chunk'), question('gentest-replace-chunk')],
      levelId: 'lv-ai-gentest-replace',
    });
    if (!twoQuestions.ok) throw new Error(twoQuestions.message);

    await service.persistSpec(twoQuestions.spec, 'gentest-replace');
    const before = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM level_items WHERE level_id = 'lv-ai-gentest-replace'`,
    );
    expect(Number(before[0]!.n)).toBe(2);

    // 第二次只有 1 道题 → 旧的两道应该被删掉，只留一道
    await service.persistSpec(specFor('gentest-replace', 'gentest-replace-chunk'), 'gentest-replace');
    const after = await db.query<{ id: string }>(
      `SELECT id FROM level_items WHERE level_id = 'lv-ai-gentest-replace' ORDER BY id`,
    );
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe('lv-ai-gentest-replace-q1');
  });

  it('覆盖落库保留原 ordinal（重跑不会把关卡往后挤）', async () => {
    await seedKp(db, 'gentest-ordinal');
    const spec = specFor('gentest-ordinal', 'gentest-ordinal-chunk');

    await service.persistSpec(spec, 'gentest-ordinal');
    const first = await db.query<{ ordinal: number }>(
      `SELECT ordinal FROM levels WHERE id = 'lv-ai-gentest-ordinal'`,
    );

    await service.persistSpec(spec, 'gentest-ordinal');
    const second = await db.query<{ ordinal: number }>(
      `SELECT ordinal FROM levels WHERE id = 'lv-ai-gentest-ordinal'`,
    );

    expect(second[0]!.ordinal).toBe(first[0]!.ordinal);
  });

  // ── practice 池护栏（验收④）────────────────────────────────────────────

  it('落库的 AI 关卡每题都在 practice 池，author 是 ai', async () => {
    await seedKp(db, 'gentest-pool');
    await service.persistSpec(specFor('gentest-pool', 'gentest-pool-chunk'), 'gentest-pool');

    const row = await db.query<{ spec: { meta: { author: string }; items: Array<{ pool: string }> } }>(
      `SELECT spec FROM levels WHERE id = 'lv-ai-gentest-pool'`,
    );
    expect(row[0]!.spec.meta.author).toBe('ai');
    for (const item of row[0]!.spec.items) expect(item.pool).toBe('practice');

    // level_items 的池词表是 quiz/practice（spec 的 core 映射成 quiz）
    const items = await db.query<{ pool: string }>(
      `SELECT pool FROM level_items WHERE level_id = 'lv-ai-gentest-pool'`,
    );
    expect(items.every((i) => i.pool === 'practice')).toBe(true);
  });

  it(
    '绕过服务层直接 UPDATE，把 AI 关卡的题改成 core 池 → 触发器拦下',
    async () => {
      await seedKp(db, 'gentest-guard');
      await service.persistSpec(specFor('gentest-guard', 'gentest-guard-chunk'), 'gentest-guard');

      // 这是验收④的**硬测试**：模拟「某条没走 save 的路径」直接改库。
      // 校验器拦不住这种写入（它只在写入路径上跑），触发器能。
      const row = await db.query<{ spec: Record<string, unknown> }>(
        `SELECT spec FROM levels WHERE id = 'lv-ai-gentest-guard'`,
      );
      const tampered = JSON.parse(JSON.stringify(row[0]!.spec)) as {
        items: Array<{ pool: string }>;
      };
      tampered.items[0]!.pool = 'core';

      await expect(
        db.query(`UPDATE levels SET spec = $1::jsonb WHERE id = 'lv-ai-gentest-guard'`, [
          JSON.stringify(tampered),
        ]),
      ).rejects.toThrow(/AI 生成的关卡只能进 practice 池/);
    },
    30_000,
  );

  it(
    '把 author 改成 teacher 后同样的写入被允许（人工放行的唯一方式）',
    async () => {
      await seedKp(db, 'gentest-release');
      await service.persistSpec(specFor('gentest-release', 'gentest-release-chunk'), 'gentest-release');

      const row = await db.query<{ spec: Record<string, unknown> }>(
        `SELECT spec FROM levels WHERE id = 'lv-ai-gentest-release'`,
      );
      const promoted = JSON.parse(JSON.stringify(row[0]!.spec)) as {
        meta: { author: string };
        items: Array<{ pool: string }>;
      };
      promoted.meta.author = 'teacher';
      promoted.items[0]!.pool = 'core';

      // 不抛错 —— 改成 teacher 那一步本身就是「有人看过并担保」
      await expect(
        db.query(`UPDATE levels SET spec = $1::jsonb WHERE id = 'lv-ai-gentest-release'`, [
          JSON.stringify(promoted),
        ]),
      ).resolves.toBeDefined();
    },
    30_000,
  );

  // ── 材料装载 ────────────────────────────────────────────────────────────

  it('loadMaterial 只取够长的 text/formula 片段，跳过图注', async () => {
    await seedKp(db, 'gentest-mat', { chunkLength: 120 });
    // 再补一条短碎片和一条图注，两者都不该被选中
    await db.query(
      `INSERT INTO chunks (id, source_id, ordinal, kind, text, page, micro_kp_id)
       VALUES ('gentest-mat-short', 'gentest-src', 2, 'text', '第 34 页', 34, 'gentest-mat'),
              ('gentest-mat-fig', 'gentest-src', 3, 'figure', $1, 35, 'gentest-mat')`,
      ['图 2.1.3 是一个与门符号，输入端为 A 与 B，输出端为 Y。'.repeat(3)],
    );

    const material = await service.loadMaterial('gentest-mat');
    expect(material).not.toBeNull();
    expect(material!.microKpName).toBe('知识点 gentest-mat');
    const chunkIds = material!.excerpts.map((e) => e.chunkId);
    expect(chunkIds).toContain('gentest-mat-chunk');
    expect(chunkIds).not.toContain('gentest-mat-short');
    expect(chunkIds).not.toContain('gentest-mat-fig');
  });

  it('知识点没有够长的片段 → loadMaterial 返回 null（不编题）', async () => {
    await seedKp(db, 'gentest-nomat', { chunkLength: 12 });
    expect(await service.loadMaterial('gentest-nomat')).toBeNull();
  });

  it('pickTargets 只挑有长片段的叶子知识点，且优先没生成过的', async () => {
    await seedKp(db, 'gentest-pick-a', { chunkLength: 100 });
    await seedKp(db, 'gentest-pick-b', { chunkLength: 100 });
    // 先给 a 生成一张关卡，它应该排到 b 后面
    await service.persistSpec(specFor('gentest-pick-a', 'gentest-pick-a-chunk'), 'gentest-pick-a');

    const picked = await service.pickTargets(50);
    const ia = picked.indexOf('gentest-pick-a');
    const ib = picked.indexOf('gentest-pick-b');
    expect(ia).toBeGreaterThanOrEqual(0);
    expect(ib).toBeGreaterThanOrEqual(0);
    expect(ib).toBeLessThan(ia);
  });

  // ── tiebreak：材料量取代 ordinal（回归测试）────────────────────────────
  //
  // 这一组是真实缺陷的回归测试。修之前：内容管线的 20 个「小结/习题」节点
  // ordinal 是默认 0，正常知识点从 1 起，于是 AI 生成 12 次挑 12 次全挑中
  // 那些节点。修之后：材料多的赢，ordinal 只做完全并列时的兜底。

  it('pickTargets 按材料量排序：ordinal 更小但材料更少的排在后面', async () => {
    // 模拟章末「小结」：ordinal = 0（更小，旧排序会让它赢）但只有 1 个片段
    await seedKp(db, 'gentest-tie-noise', { ordinal: 0, chunkCount: 1 });
    // 模拟正常知识点：ordinal = 1（更大，旧排序会输）但有 3 个片段
    await seedKp(db, 'gentest-tie-real', { ordinal: 1, chunkCount: 3 });

    const picked = await service.pickTargets(50);
    const noise = picked.indexOf('gentest-tie-noise');
    const real = picked.indexOf('gentest-tie-real');
    expect(noise).toBeGreaterThanOrEqual(0);
    expect(real).toBeGreaterThanOrEqual(0);
    // 材料多的赢 —— 与 ordinal 大小正好相反，这样才能证明是材料量在起作用
    expect(real).toBeLessThan(noise);
  });

  it('pickTargets 把「零材料」当硬前置，而不是只排到后面', async () => {
    // 有知识点、ordinal 最小、但从没有合格片段 → 不该出现在候选里
    await seedKp(db, 'gentest-nomat-pick', { ordinal: 0, chunkCount: 0 });
    await seedKp(db, 'gentest-hasmat-pick', { ordinal: 9, chunkCount: 1 });

    const picked = await service.pickTargets(50);
    // 关键断言：不是「排在后面」，是**根本不出现**
    expect(picked).not.toContain('gentest-nomat-pick');
    expect(picked).toContain('gentest-hasmat-pick');
  });

  // ── 失败原因汇总（验收⑤）───────────────────────────────────────────────

  it('getRun 的 failures 按 kind 汇总并给出典型原文', async () => {
    await seedKp(db, 'gentest-sum-a');
    await seedKp(db, 'gentest-sum-b');
    await seedKp(db, 'gentest-sum-c');
    await service.createRun({
      runId: 'gentest-run-6',
      microKpIds: ['gentest-sum-a', 'gentest-sum-b', 'gentest-sum-c'],
      concurrency: 3,
    });

    await service.markTask({
      runId: 'gentest-run-6',
      microKpId: 'gentest-sum-a',
      status: 'failed',
      failureKind: 'not_json',
      failureMessage: '模型夹了中文解释',
    });
    await service.markTask({
      runId: 'gentest-run-6',
      microKpId: 'gentest-sum-b',
      status: 'failed',
      failureKind: 'not_json',
      failureMessage: '第二条同类失败',
    });
    await service.markTask({
      runId: 'gentest-run-6',
      microKpId: 'gentest-sum-c',
      status: 'failed',
      failureKind: 'language_not_compliant',
      failureMessage: 'explainWrong 只有 0 个汉字',
    });
    await service.finishRun('gentest-run-6');

    const run = await service.getRun('gentest-run-6');
    const byKind = new Map(run!.failures.map((f) => [f.kind, f]));
    expect(byKind.get('not_json')!.count).toBe(2);
    expect(byKind.get('not_json')!.sample).toBe('模型夹了中文解释');
    expect(byKind.get('language_not_compliant')!.count).toBe(1);
    // 按 count 降序：not_json 在前
    expect(run!.failures[0]!.kind).toBe('not_json');
  });

  it('reapStaleRuns 把超时的 running 运行标成 failed', async () => {
    await seedKp(db, 'gentest-stale');
    await service.createRun({ runId: 'gentest-run-7', microKpIds: ['gentest-stale'], concurrency: 1 });
    // 把 started_at 拨到 1 小时前，模拟进程被杀
    await db.query(
      `UPDATE level_generation_run SET started_at = now() - interval '1 hour' WHERE id = 'gentest-run-7'`,
    );

    const reaped = await service.reapStaleRuns(30);
    expect(reaped).toBeGreaterThanOrEqual(1);

    const list = await service.listRuns(100);
    expect(list.items.find((i) => i.runId === 'gentest-run-7')!.status).toBe('failed');
  });

  it('刚启动的 running 运行不会被 reap（可能有别的实例在跑）', async () => {
    await seedKp(db, 'gentest-fresh');
    await service.createRun({ runId: 'gentest-run-8', microKpIds: ['gentest-fresh'], concurrency: 1 });

    await service.reapStaleRuns(30);
    const list = await service.listRuns(100);
    expect(list.items.find((i) => i.runId === 'gentest-run-8')!.status).toBe('running');
  });
});

describe('summarizeFailures', () => {
  const task = (
    kind: GenerationTask['failureKind'],
    status: GenerationTask['status'],
    message: string | null,
  ): GenerationTask => ({
    taskId: 't',
    microKpId: 'kp',
    microKpName: 'kp',
    status,
    failureKind: kind,
    failureMessage: message,
    failureDetail: null,
    levelId: null,
    levelTitle: null,
    itemCount: 0,
    attempts: 1,
    durationMs: 10,
  });

  it('只统计 failed 的任务，成功的不进汇总', () => {
    const summary = summarizeFailures([
      task(null, 'succeeded', null),
      task('not_json', 'failed', '不是 JSON'),
    ]);
    expect(summary).toHaveLength(1);
    expect(summary[0]!.count).toBe(1);
  });

  it('failed 但没有 kind 的任务被跳过（不产生 undefined 分组）', () => {
    const summary = summarizeFailures([task(null, 'failed', '未知原因')]);
    expect(summary).toEqual([]);
  });

  it('没有记录 message 时给一句占位而不是空字符串', () => {
    const summary = summarizeFailures([task('db_error', 'failed', null)]);
    expect(summary[0]!.sample).toBe('（没有记录原因）');
  });
});

/** 深拷贝一份 spec，验证覆盖落库不会因为同一个对象引用而走捷径 */
function specspec<T>(spec: T): T {
  return JSON.parse(JSON.stringify(spec)) as T;
}
