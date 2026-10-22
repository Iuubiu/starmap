import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { LevelSpec } from '@starmap/shared';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../db/database.service.js';
import { ScriptedLlm } from '../llm/scripted-llm.js';
import { LLM_PORT } from '../llm/llm.port.js';
import { createTestSchema, type TestSchema } from '../../test/test-schema.js';
import { assertMatchesContract } from '../../test/contract.js';

/**
 * 票 12（三档渲染参数）的接口级验收。
 *
 * ## 这一票最容易做假的地方
 *
 * 1. **参数只存在库里**。票面第一句就是「真正驱动界面与策略，不是只存在
 *    数据库里」。断言 `GET /tier` 返回 `firstRoundShape:'worked_example'`
 *    什么也证明不了 —— 那可能只是一张没人读的常量表。所以真正的断言在
 *    `GET /tier/levels/:id/plan`：它必须**读这一关的真实 spec**，算出从第几段
 *    开始、哪张卡要藏正文。这里用真实的 `lv-bool-laws.spec.json`（7 段、4 题），
 *    断言 P3 从第 3 段（第一段带题的 `probe`）开始、P1 从第 1 段开始 ——
 *    如果实现只是把 `firstRoundShape` 原样回传，这两个下标不可能对。
 *
 * 2. **三档参数抄成同一份**。三档各有六维参数，最省事的实现是复制粘贴后
 *    忘了改某几维。这里逐个断言 P1/P2/P3 的六维取值，并**同时**断言三档
 *    两两不同（`firstRoundShape` / `ladder` / `sessionNewKpLimit` /
 *    `feedbackTiming` / `attemptsPerItem` / `masteryRule` 至少各有一处差异）。
 *    只断言「每档有六个字段」的话，三档一模一样照样绿。
 *
 * 3. **掌握判定读了本地状态**。`masteryProgress` 必须来自 `app.attempts`
 *    的回放（跨关卡、跨会话），不是页面本地计数。这里在整场前后数一次
 *    `attempts` 行数断言不变（只读接口不该写库），并**正向对照**：插入 2 条
 *    答对证据后 `consecutiveCorrect` 必须从 0 变 2 —— 否则「恒为 0」也能过。
 *
 * 4. **「为什么给我降档了」没有内容**。验收 3 要求学习者能看到解释。这里
 *    直接往 `learning_log` 插一条 `tier_rejudge` 事件，断言 `GET /tier/changes`
 *    把它读出来、字段逐个对得上、且新的在前（插两条不同时刻，断言顺序）。
 *    只断言「返回数组」的话，空数组也是绿的 —— 所以另有一条「没有事件时是
 *    空数组」的用例做对照。
 *
 * ## 为什么档位靠直接写 `placement_profile` 而不走定级接口
 *
 * 定级要答 8–18 题才出结果，且它的停止条件由后验驱动 —— 想稳定得到 P1 得
 * 全答错、想稳定得到 P3 得全答对，一场下来几十个请求，而本票要验的是
 * 「拿到某一档之后怎么渲染」。档位是这一票的**输入**，不是被测对象（那是
 * 票 11 的 `placement.controller.test.ts` 已经覆盖的）。直接写那一行单行表，
 * 测试才在说「给定 P2，渲染出什么」。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const contentPath = join(repoRoot, 'content', 'levels', 'lv-bool-laws.spec.json');
const contentSpec = JSON.parse(readFileSync(contentPath, 'utf8')) as LevelSpec;

/** 本套件自己的关卡 id，避开其它套件的固定断言。 */
const LEVEL_ID = 'lv-tiertest';
const MICRO_KP_ID = 'kp-tiertest';

interface TierParamsBody {
  tier: 'P1' | 'P2' | 'P3';
  firstRoundShape: 'worked_example' | 'completion' | 'direct';
  ladder: { start: number; cap: number };
  sessionNewKpLimit: number;
  feedbackTiming: 'step_immediate' | 'step_immediate_with_summary' | 'item_deferred_with_summary';
  attemptsPerItem: number;
  masteryRule: { consecutiveCorrect: number; requiresTransferItem: boolean };
}

interface OverviewBody {
  tier: 'P1' | 'P2' | 'P3';
  source: 'placement' | 'fallback';
  params: TierParamsBody;
  label: string;
  description: string;
}

interface LevelPlanBody {
  levelId: string;
  microKpId: string;
  tier: 'P1' | 'P2' | 'P3';
  source: 'placement' | 'fallback';
  params: TierParamsBody;
  firstRound: {
    shape: 'worked_example' | 'completion' | 'direct';
    startStepIndex: number;
    cardMode: 'all' | 'faded' | 'none';
    fadedCardId: string | null;
  };
  masteryProgress: {
    consecutiveCorrect: number;
    hasTransferItem: boolean;
    satisfied: boolean;
    missing: string[];
  };
}

interface ChangeBody {
  id: string;
  at: string;
  previousTier: 'P1' | 'P2' | 'P3';
  tier: 'P1' | 'P2' | 'P3';
  changed: boolean;
  attemptsSince: number;
  averageFirstTryRate: number | null;
  explanation: string;
}

interface ChangesBody {
  items: ChangeBody[];
}

interface SessionPlanBody {
  tier: 'P1' | 'P2' | 'P3';
  source: 'placement' | 'fallback';
  limit: number;
  items: Array<{ microKpId: string; name: string; hasLevel: boolean }>;
  deferred: number;
}

let app: INestApplication;
let schema: TestSchema;
let db: DatabaseService;

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

  await db.query(`INSERT INTO ${schema.name}.subjects (id, name) VALUES ('subj-tiertest', '测试学科')`);
  await db.query(
    `INSERT INTO ${schema.name}.modules (id, subject_id, name, tier, ordinal)
     VALUES ('mod-tiertest', 'subj-tiertest', '测试模块', 'A', 1)`,
  );
  await db.query(
    `INSERT INTO ${schema.name}.knowledge_points (id, module_id, parent_id, name, is_leaf, depth, ordinal)
     VALUES ($1, 'mod-tiertest', NULL, '逻辑代数基本律', true, 0, 1)`,
    [MICRO_KP_ID],
  );
  // 第二、三个叶知识点：`session-plan` 的「单次会话上限」要能观察到被截断，
  // 至少需要 3 个候选（P1 上限 2 → deferred 1）。只种 1 个的话三档都返回
  // 1 个，「上限生效」这件事永远测不出来。
  //
  // ⚠️ 光有叶节点行不够：`RecommendService.computeAll` 的候选集带**内容前置**
  // （t24 第 4 条）：一个叶节点必须「有 chunk」或「有关卡」，否则不推给学习者。
  // 这是对的——零内容的知识点推出去，点进去只有空白页。
  //
  // 本套件因此给三个知识点都种 chunk。缺陷曾经在这里被**误判成实现 bug**：
  // session-plan 只返回 1 条，看起来像「上限没生效」，实际是另外两个知识点
  // 被内容前置正确过滤掉了。测试的数据要满足被测逻辑的**前置条件**，否则
  // 断言测的是另一件事。
  await db.query(
    `INSERT INTO ${schema.name}.sources (id, title, kind, meta)
     VALUES ('src-tiertest', '测试用书', 'book', '{}'::jsonb)`,
  );
  for (const [index, id] of ['kp-tier-extra-1', 'kp-tier-extra-2'].entries()) {
    await db.query(
      `INSERT INTO ${schema.name}.knowledge_points (id, module_id, parent_id, name, is_leaf, depth, ordinal)
       VALUES ($1, 'mod-tiertest', NULL, $2, true, 0, $3)`,
      [id, `补充知识点 ${index + 1}`, index + 2],
    );
  }
  for (const id of [MICRO_KP_ID, 'kp-tier-extra-1', 'kp-tier-extra-2']) {
    await db.query(
      `INSERT INTO ${schema.name}.chunks (id, source_id, ordinal, kind, text, page, micro_kp_id, meta)
       VALUES ($1, 'src-tiertest', 0, 'text', $2, 1, $3, '{}'::jsonb)`,
      [`ck-${id}`, `${id} 的原文`, id],
    );
  }

  await db.query(
    `INSERT INTO ${schema.name}.levels (id, micro_kp_id, title, kind, ordinal, spec)
     VALUES ($1, $2, $3, 'teach', 1, $4::jsonb)`,
    [LEVEL_ID, MICRO_KP_ID, contentSpec.meta.title, JSON.stringify(contentSpec)],
  );
  // 坏 spec：用来证明 500 也带字段级 details（与 `LevelsController` 同一条规则）。
  await db.query(
    `INSERT INTO ${schema.name}.levels (id, micro_kp_id, title, kind, ordinal, spec)
     VALUES ('lv-tiertest-broken', $1, '坏关卡', 'teach', 2, $2::jsonb)`,
    [MICRO_KP_ID, JSON.stringify({ ...contentSpec, steps: [] })],
  );

  /**
   * 题目也要进 `level_items`，**不是**只放在 `levels.spec` 里。
   *
   * `app.attempts.item_id` 有指向 `level_items(id)` 的外键（0001_init.sql:101），
   * 所以想造「作答证据」就必须先有题目行。这条最初漏了，症状是三条掌握判定
   * 用例全红在 `violates foreign key constraint "attempts_item_id_fkey"` ——
   * 而错误信息里不会提示「你少种了一张表」。
   *
   * `pool` 的取值域与 spec 不同：表里是 `('quiz','practice')`，spec 里是
   * `('core','practice')`，`core` 对应表里的 `quiz`（0010 迁移的同一套映射）。
   */
  for (const item of contentSpec.items) {
    await db.query(
      `INSERT INTO ${schema.name}.level_items
         (id, level_id, stem, options, answer, explain_correct, explain_wrong,
          misconception_tags, source_ref, variant_group, pool)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8::text[], $9, $10, $11)`,
      [
        item.id,
        LEVEL_ID,
        item.stem,
        JSON.stringify(item.options),
        JSON.stringify(item.answer),
        item.explainCorrect,
        item.explainWrong,
        item.misconceptionTags,
        item.sourceRef,
        item.variantGroup,
        item.pool === 'core' ? 'quiz' : 'practice',
      ],
    );
  }
}, 60_000);

afterAll(async () => {
  await app?.close();
  await schema?.drop();
});

/**
 * 每个用例从「有定级、零证据」开始。
 *
 * 不重置的话，上一条用例插进去的 `attempts` 会让 `masteryProgress` 带着
 * 「连对 2 次」开局 —— 那正是「测试之间借状态」：单跑绿、全量跑红。
 */
beforeEach(async () => {
  await db.query(`DELETE FROM ${schema.name}.attempts WHERE micro_kp_id = $1`, [MICRO_KP_ID]);
  await db.query(`DELETE FROM ${schema.name}.learning_log WHERE event = 'tier_rejudge'`);
  await db.query(`DELETE FROM ${schema.name}.placement_profile`);
});

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/** 把档位直接写成给定值（档位是这一票的输入，见文件头）。 */
async function setTier(tier: 'P1' | 'P2' | 'P3'): Promise<void> {
  await db.query(
    `INSERT INTO ${schema.name}.placement_profile (id, tier, status, attempts_baseline)
     VALUES (1, $1, 'provisional', 0)`,
    [tier],
  );
}

async function overview(): Promise<OverviewBody> {
  const res = await request(app.getHttpServer()).get('/api/v1/tier').expect(200);
  assertMatchesContract('/api/v1/tier', 'get', 200, res.body);
  return res.body as OverviewBody;
}

async function levelPlan(levelId = LEVEL_ID): Promise<LevelPlanBody> {
  const res = await request(app.getHttpServer())
    .get(`/api/v1/tier/levels/${levelId}/plan`)
    .expect(200);
  assertMatchesContract('/api/v1/tier/levels/{levelId}/plan', 'get', 200, res.body);
  return res.body as LevelPlanBody;
}

async function changes(limit?: number): Promise<ChangesBody> {
  const query = limit === undefined ? '' : `?limit=${limit}`;
  const res = await request(app.getHttpServer()).get(`/api/v1/tier/changes${query}`).expect(200);
  assertMatchesContract('/api/v1/tier/changes', 'get', 200, res.body);
  return res.body as ChangesBody;
}

async function sessionPlan(): Promise<SessionPlanBody> {
  const res = await request(app.getHttpServer()).get('/api/v1/tier/session-plan').expect(200);
  assertMatchesContract('/api/v1/tier/session-plan', 'get', 200, res.body);
  return res.body as SessionPlanBody;
}

/**
 * 插一条计入掌握度的作答证据。
 *
 * `item_id` 必须是真的题目行（外键），所以这里用 `contentSpec` 里真实的四道题
 * 轮流取 —— 顺带让「同一道题被答过多次」这件事出现在数据里，那正是真实库的
 * 形状（`attempt_no` 就是为它存在的）。
 */
async function seedAttempt(options: {
  correct: boolean;
  knowledgeKind: 'fact' | 'concept' | 'comprehensive';
  minutesAgo: number;
}): Promise<void> {
  const item = contentSpec.items.find((entry) => entry.kind === options.knowledgeKind);
  if (!item) throw new Error(`spec 里没有 kind=${options.knowledgeKind} 的题`);
  await db.query(
    `INSERT INTO ${schema.name}.attempts
       (micro_kp_id, item_id, variant_group, correct, answer, knowledge_kind,
        counts_toward_mastery, created_at)
     VALUES ($1, $2, $3, $4, '0'::jsonb, $5, true, now() - ($6 || ' minutes')::interval)`,
    [
      MICRO_KP_ID,
      item.id,
      item.variantGroup,
      options.correct,
      options.knowledgeKind,
      String(options.minutesAgo),
    ],
  );
}

async function rowCount(table: string): Promise<number> {
  const rows = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${schema.name}.${table}`,
  );
  return rows[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------

describe('GET /api/v1/tier：六维参数', () => {
  it('没有定级记录时回落到 P1，并用 source 说清这是默认值', async () => {
    const body = await overview();
    expect(body.tier).toBe('P1');
    // 关键：不是 404，也不是 tier:null。新用户第一次打开就该看到能用的界面，
    // 但界面上不能说「你的水平是 P1」—— 那是 `source` 的职责。
    expect(body.source).toBe('fallback');
    expect(body.params.tier).toBe('P1');
    expect(body.label).toBe('完整样例');
    expect(body.description.length).toBeGreaterThan(0);
  });

  it('三档的六维参数逐项正确，且三档之间真的不同', async () => {
    await setTier('P1');
    const p1 = await overview();
    await db.query(`DELETE FROM ${schema.name}.placement_profile`);
    await setTier('P2');
    const p2 = await overview();
    await db.query(`DELETE FROM ${schema.name}.placement_profile`);
    await setTier('P3');
    const p3 = await overview();

    // spec.md:274-280 那张表逐行对照。
    expect(p1.source).toBe('placement');
    expect(p1.params).toMatchObject({
      tier: 'P1',
      firstRoundShape: 'worked_example',
      ladder: { start: 1, cap: 3 },
      sessionNewKpLimit: 2,
      feedbackTiming: 'step_immediate',
      attemptsPerItem: 2,
      masteryRule: { consecutiveCorrect: 2, requiresTransferItem: true },
    });
    expect(p2.params).toMatchObject({
      tier: 'P2',
      firstRoundShape: 'completion',
      ladder: { start: 2, cap: 4 },
      sessionNewKpLimit: 3,
      feedbackTiming: 'step_immediate_with_summary',
      attemptsPerItem: 2,
      masteryRule: { consecutiveCorrect: 2, requiresTransferItem: true },
    });
    expect(p3.params).toMatchObject({
      tier: 'P3',
      firstRoundShape: 'direct',
      ladder: { start: 3, cap: 5 },
      sessionNewKpLimit: 4,
      feedbackTiming: 'item_deferred_with_summary',
      attemptsPerItem: 1,
      masteryRule: { consecutiveCorrect: 1, requiresTransferItem: true },
    });

    // 六维逐个断言「有差异」的维度集合。逐项 toMatchObject 只证明「各自符合
    // 预期」，这一条证明「没有任何一维是三档共用的复制粘贴」。
    const dimensions = [
      (params: TierParamsBody) => params.firstRoundShape,
      (params: TierParamsBody) => `${params.ladder.start}/${params.ladder.cap}`,
      (params: TierParamsBody) => params.sessionNewKpLimit,
      (params: TierParamsBody) => params.feedbackTiming,
      (params: TierParamsBody) => params.attemptsPerItem,
      (params: TierParamsBody) => params.masteryRule.consecutiveCorrect,
    ];
    for (const read of dimensions) {
      const values = [p1.params, p2.params, p3.params].map(read);
      expect(new Set(values).size).toBeGreaterThan(1);
    }
    // P1 与 P2 的「每题尝试次数」按 spec 相同（都是 2），这条把「允许相同」
    // 与「抄错了」区分开：只有 `attemptsPerItem` 这一维允许两档相等。
    expect(p1.params.attemptsPerItem).toBe(p2.params.attemptsPerItem);
    expect(p2.params.attemptsPerItem).not.toBe(p3.params.attemptsPerItem);
  });

  it('档位变了，标签与说明跟着变（不是一张写死的文案表）', async () => {
    await setTier('P1');
    const p1 = await overview();
    await db.query(`DELETE FROM ${schema.name}.placement_profile`);
    await setTier('P3');
    const p3 = await overview();

    expect(p1.label).toBe('完整样例');
    expect(p3.label).toBe('直接出题');
    expect(p1.description).not.toBe(p3.description);
  });
});

describe('GET /api/v1/tier/levels/{levelId}/plan：首轮计划读真实 spec', () => {
  it('P1 从第 1 段开始、卡片全展开', async () => {
    await setTier('P1');
    const plan = await levelPlan();
    expect(plan.levelId).toBe(LEVEL_ID);
    expect(plan.microKpId).toBe(MICRO_KP_ID);
    expect(plan.firstRound).toEqual({
      shape: 'worked_example',
      startStepIndex: 0,
      cardMode: 'all',
      fadedCardId: null,
    });
  });

  it('P2 从第 1 段开始，但第一段最后一张卡藏正文', async () => {
    await setTier('P2');
    const plan = await levelPlan();
    expect(plan.firstRound.shape).toBe('completion');
    expect(plan.firstRound.startStepIndex).toBe(0);
    expect(plan.firstRound.cardMode).toBe('faded');
    // forward fading 藏的是「第一段带卡的段的最后一张卡」。
    // 真实 spec 第 1 段是 `s-guide`，只有 `c-guide` 一张卡。
    const firstCardStep = contentSpec.steps.find((step) => step.cardIds.length > 0);
    expect(plan.firstRound.fadedCardId).toBe(
      firstCardStep?.cardIds[firstCardStep.cardIds.length - 1],
    );
    expect(plan.firstRound.fadedCardId).toBe('c-guide');
  });

  it('P3 跳过所有纯讲解段，直接落在第一段带题的段', async () => {
    await setTier('P3');
    const plan = await levelPlan();
    expect(plan.firstRound.shape).toBe('direct');
    expect(plan.firstRound.cardMode).toBe('none');
    expect(plan.firstRound.fadedCardId).toBeNull();
    // 真实 spec 的段序：0 guide（1 卡）/ 1 detail（2 卡）/ 2 probe（1 题）/
    // 3 deepen / 4 reteach / 5 quiz / 6 summary。第一段带题的是下标 2。
    expect(plan.firstRound.startStepIndex).toBe(2);
    expect(contentSpec.steps[2]?.kind).toBe('probe');
    expect(contentSpec.steps[2]?.itemIds.length).toBeGreaterThan(0);
    // 反向对照：这个下标**不是** 0 —— 如果实现只把 shape 回传、下标恒 0，
    // 上面两条断言仍然绿，这一条才会红。
    expect(plan.firstRound.startStepIndex).not.toBe(0);
  });

  it('三档的首轮计划两两不同（同一关卡、同一份 spec）', async () => {
    await setTier('P1');
    const p1 = await levelPlan();
    await db.query(`DELETE FROM ${schema.name}.placement_profile`);
    await setTier('P2');
    const p2 = await levelPlan();
    await db.query(`DELETE FROM ${schema.name}.placement_profile`);
    await setTier('P3');
    const p3 = await levelPlan();

    expect(p1.firstRound).not.toEqual(p2.firstRound);
    expect(p2.firstRound).not.toEqual(p3.firstRound);
    expect(p1.firstRound).not.toEqual(p3.firstRound);
    // 「参数一样但渲染一样」是最常见的假绿：这里同时断言参数也跟着变了。
    expect(new Set([p1.tier, p2.tier, p3.tier]).size).toBe(3);
  });

  it('关卡不存在时 404，坏 spec 时 500 且带字段级 details', async () => {
    await setTier('P2');

    const missing = await request(app.getHttpServer())
      .get('/api/v1/tier/levels/lv-does-not-exist/plan')
      .expect(404);
    assertMatchesContract('/api/v1/tier/levels/{levelId}/plan', 'get', 404, missing.body);
    expect((missing.body as { code: string }).code).toBe('NOT_FOUND');

    const broken = await request(app.getHttpServer())
      .get('/api/v1/tier/levels/lv-tiertest-broken/plan')
      .expect(500);
    const body = broken.body as { code: string; details?: unknown[] };
    expect(body.code).toBe('INTERNAL');
    // 坏 spec 是服务端数据问题（500），不是调用方传错参数（400）——
    // 而且必须说清哪一段不对，否则运维只能靠猜。
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details?.length).toBeGreaterThan(0);
  });
});

describe('掌握判定按本档规则算，证据来自 attempts 回放', () => {
  it('零证据时说清还差什么，且只读接口不写任何证据', async () => {
    await setTier('P2');
    const before = await rowCount('attempts');

    const plan = await levelPlan();
    expect(plan.masteryProgress.consecutiveCorrect).toBe(0);
    expect(plan.masteryProgress.hasTransferItem).toBe(false);
    expect(plan.masteryProgress.satisfied).toBe(false);
    expect(plan.masteryProgress.missing.length).toBeGreaterThan(0);
    // 说人话：不能只给一个布尔，验收要求「学习者能看到为什么」。
    expect(plan.masteryProgress.missing.join('\n')).toMatch(/连续答对|迁移题/);

    // 只读接口不该产生证据。这条是「悄悄写掌握度」的反向守卫 ——
    // 票 11 明令定级不写掌握度，票 12 的读接口同理。
    expect(await rowCount('attempts')).toBe(before);
  });

  it('连续答对 2 次后，P2 只差迁移题；P3 只需连对 1 次就已满足', async () => {
    await setTier('P2');
    await seedAttempt({ correct: true, knowledgeKind: 'concept', minutesAgo: 20 });
    await seedAttempt({ correct: true, knowledgeKind: 'concept', minutesAgo: 10 });

    const p2 = await levelPlan();
    expect(p2.masteryProgress.consecutiveCorrect).toBe(2);
    expect(p2.masteryProgress.hasTransferItem).toBe(false);
    expect(p2.masteryProgress.satisfied).toBe(false);
    expect(p2.masteryProgress.missing.join('\n')).toMatch(/迁移题/);

    await db.query(`DELETE FROM ${schema.name}.placement_profile`);
    await setTier('P3');
    const p3 = await levelPlan();
    // P3 的规则是「连对 1 次 + 迁移题」，此时连对 2 次但没做过迁移题 ——
    // 仍然不满足。这条证明 `requiresTransferItem` 不是一句写在文档里的话。
    expect(p3.masteryProgress.consecutiveCorrect).toBe(2);
    expect(p3.masteryProgress.satisfied).toBe(false);
    expect(p3.masteryProgress.missing.join('\n')).toMatch(/迁移题/);
  });

  it('做过迁移题之后 P3 立即满足，P2 需要连对 2 次且迁移题都到齐', async () => {
    await setTier('P3');
    await seedAttempt({ correct: true, knowledgeKind: 'concept', minutesAgo: 30 });
    await seedAttempt({ correct: true, knowledgeKind: 'comprehensive', minutesAgo: 20 });
    const p3 = await levelPlan();
    expect(p3.masteryProgress.hasTransferItem).toBe(true);
    expect(p3.masteryProgress.consecutiveCorrect).toBe(2);
    expect(p3.masteryProgress.satisfied).toBe(true);
    expect(p3.masteryProgress.missing).toEqual([]);

    // 同一批证据在 P2 下也满足（连对 2 + 迁移题）—— 两档的差别在 P3 只要求
    // 连对 1 次。用「答错一次」把连对数打回 1，P3 仍满足、P2 不再满足，
    // 这才是两档规则的真正分界。
    await db.query(`DELETE FROM ${schema.name}.placement_profile`);
    await setTier('P2');
    await seedAttempt({ correct: false, knowledgeKind: 'concept', minutesAgo: 10 });
    const p2 = await levelPlan();
    expect(p2.masteryProgress.consecutiveCorrect).toBe(0);
    expect(p2.masteryProgress.hasTransferItem).toBe(true);
    expect(p2.masteryProgress.satisfied).toBe(false);
  });

  it('深究段的作答（counts_toward_mastery=false）不进判定', async () => {
    await setTier('P2');
    await seedAttempt({ correct: true, knowledgeKind: 'concept', minutesAgo: 20 });
    // 一条「不计分」的答错：如果实现忘了过滤这一列，连对数会从 1 掉到 0。
    await db.query(
      `INSERT INTO ${schema.name}.attempts
         (micro_kp_id, item_id, variant_group, correct, answer, knowledge_kind,
          counts_toward_mastery, created_at)
       VALUES ($1, 'i-deepen-demorgan', 'vg-demorgan', false, '0'::jsonb, 'concept', false, now())`,
      [MICRO_KP_ID],
    );

    const plan = await levelPlan();
    expect(plan.masteryProgress.consecutiveCorrect).toBe(1);
  });
});

describe('GET /api/v1/tier/changes：为什么给我降档了', () => {
  it('没有重判事件时是空数组，不是 404', async () => {
    await setTier('P2');
    const body = await changes();
    expect(body.items).toEqual([]);
  });

  /**
   * 票 11 的重判是**读时惰性结算**。这条用例直接打 `/tier/changes`，
   * 中途**不先读** `/tier`：门槛已到时，历史里必须已经有那一条。
   *
   * 去掉 `TierService.changes()` 开头那句 `await this.placement.status()`
   * 之后，这条会变成 `expected [] to have a length of 1` —— 而其它用例
   * 都绿，因为它们都先调了 `levelPlan()`/`overview()`，顺手把结算做了。
   * 缺陷只在「学习者被降档后直接去看变更历史」这一条路径上出现。
   */
  it('门槛已到但还没人读过档位时，读历史会先把重判结算掉', async () => {
    await setTier('P2');
    // 5 题 = `PLACEMENT_LIMITS.rejudgeAfterAttempts`，刚好到门槛。
    for (let index = 0; index < 5; index += 1) {
      await seedAttempt({ correct: true, knowledgeKind: 'concept', minutesAgo: 100 - index });
    }

    const body = await changes();
    expect(body.items).toHaveLength(1);
    // 没有任何知识点「学完」（只有 5 题、一个变式），所以首轮正确率算不出来。
    // 档位不变也是重判，也要留一条 —— 学习者看到的应该是「为什么没变」。
    expect(body.items[0]?.changed).toBe(false);
    expect(body.items[0]?.attemptsSince).toBe(5);
    expect(body.items[0]?.averageFirstTryRate).toBeNull();
    expect(body.items[0]?.explanation).toContain('暂时算不出平均首轮正确率');

    // 正向对照：真的落库了，不是内存里拼出来的。
    expect(await rowCount('learning_log')).toBeGreaterThanOrEqual(1);
    // 幂等：第二次读不会又写一条（结算是靠前移基线做到的）。
    expect((await changes()).items).toHaveLength(1);
  });

  it('把学习日志里的 tier_rejudge 事件读出来，字段逐个对得上，新的在前', async () => {
    await setTier('P3');
    const payload = {
      previousTier: 'P3',
      tier: 'P2',
      changed: true,
      attemptsSince: 9,
      averageFirstTryRate: 0.22,
      explanation: '平均首轮正确率 22%，因此把档位下调一档。',
    };
    await db.query(
      `INSERT INTO ${schema.name}.learning_log (session_id, micro_kp_id, event, payload, created_at)
       VALUES (NULL, NULL, 'tier_rejudge', $1::jsonb, now() - interval '2 days')`,
      [JSON.stringify(payload)],
    );
    await db.query(
      `INSERT INTO ${schema.name}.learning_log (session_id, micro_kp_id, event, payload, created_at)
       VALUES (NULL, NULL, 'tier_rejudge', $1::jsonb, now() - interval '1 hour')`,
      [
        JSON.stringify({
          previousTier: 'P2',
          tier: 'P3',
          changed: true,
          attemptsSince: 7,
          averageFirstTryRate: 0.85,
          explanation: '平均首轮正确率 85%，因此把档位上调一档。',
        }),
      ],
    );
    // 一条别的事件名：不能被当成档位变更读出来。
    await db.query(
      `INSERT INTO ${schema.name}.learning_log (session_id, micro_kp_id, event, payload)
       VALUES (NULL, NULL, 'recommendation_redirect', '{"recommended":"x","chosen":"y"}'::jsonb)`,
    );

    const body = await changes();
    expect(body.items).toHaveLength(2);

    const newest = body.items[0];
    expect(newest?.previousTier).toBe('P2');
    expect(newest?.tier).toBe('P3');
    expect(newest?.changed).toBe(true);
    expect(newest?.attemptsSince).toBe(7);
    expect(newest?.averageFirstTryRate).toBe(0.85);
    expect(newest?.explanation).toContain('上调一档');
    // `at` 必须是 ISO 时间：`Date.prototype.toString()` 给出的本地化格式能过
    // `z.string()`，到前端 `new Date(...)` 才乱（票 11 踩过一次）。
    expect(newest?.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const older = body.items[1];
    expect(older?.previousTier).toBe('P3');
    expect(older?.tier).toBe('P2');
    expect(older?.averageFirstTryRate).toBe(0.22);
    expect(older?.explanation).toContain('下调一档');
  });

  it('limit 生效且被夹取：非法值与越界值不报错', async () => {
    await setTier('P2');
    for (let index = 0; index < 3; index += 1) {
      await db.query(
        `INSERT INTO ${schema.name}.learning_log (session_id, micro_kp_id, event, payload, created_at)
         VALUES (NULL, NULL, 'tier_rejudge', $1::jsonb, now() - ($2 || ' minutes')::interval)`,
        [
          JSON.stringify({
            previousTier: 'P2',
            tier: 'P2',
            changed: false,
            attemptsSince: 5 + index,
            averageFirstTryRate: null,
            explanation: `第 ${index + 1} 次`,
          }),
          String(30 - index * 10),
        ],
      );
    }

    expect((await changes(2)).items).toHaveLength(2);
    // 非法值退回默认 10（不是 400）：前端从不主动传这个参数，唯一可能的
    // 输入错误是「不是数字」，那种情况下拒绝请求没有收益。
    expect((await changes(Number.NaN)).items).toHaveLength(3);
    // 越界被夹取而不是报错：0 → 1，999 → 50。
    expect((await changes(0)).items).toHaveLength(1);
    expect((await changes(999)).items).toHaveLength(3);
  });
});

describe('GET /api/v1/tier/session-plan：单次会话新知识点上限', () => {
  it('三档各自截断到 2/3/4 个，且 deferred 说清还有几个没开', async () => {
    // 本套件只有 3 个叶知识点，所以 P3（上限 4）不会被截断、deferred=0，
    // 而 P1（上限 2）会截掉 1 个。这正是「上限生效」与「上限没到」两种状态。
    await setTier('P1');
    const p1 = await sessionPlan();
    expect(p1.limit).toBe(2);
    expect(p1.items).toHaveLength(2);
    expect(p1.deferred).toBe(1);

    await db.query(`DELETE FROM ${schema.name}.placement_profile`);
    await setTier('P3');
    const p3 = await sessionPlan();
    expect(p3.limit).toBe(4);
    expect(p3.items.length).toBe(3);
    expect(p3.deferred).toBe(0);
  });

  it('hasLevel 反映这一档推荐的节点有没有现成关卡', async () => {
    await setTier('P3');
    const body = await sessionPlan();
    const withLevel = body.items.filter((item) => item.hasLevel);
    // 只有 `kp-tiertest` 挂了关卡；另外两个是「有推荐、还没生成关卡」。
    // 若实现把 hasLevel 恒写成 true 或恒写成 false，这条会红。
    expect(withLevel.map((item) => item.microKpId)).toContain(MICRO_KP_ID);
    expect(withLevel.length).toBeLessThan(body.items.length);
    for (const item of body.items) {
      expect(item.name.length).toBeGreaterThan(0);
    }
  });
});
