import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../db/database.service.js';
import { ScriptedLlm } from '../llm/scripted-llm.js';
import { LLM_PORT } from '../llm/llm.port.js';
import { createTestSchema, type TestSchema } from '../../test/test-schema.js';
import { assertMatchesContract } from '../../test/contract.js';

/**
 * 票 11（初始定级）的接口级验收。
 *
 * ## 这一票最容易做假的地方
 *
 * 定级功能可以「看起来能用」而实际上什么都没保证。三种典型假绿：
 *
 * 1. **题池随便抽**。只要接口不回 500，页面就能跑完；但若题来自全库随机
 *    抽取，定级考的可能是「他三年后才学的章节」，档位对他接下来的路没有
 *    任何预测力。所以这里种了两个**反例知识点**：一个已掌握、一个非叶容器，
 *    都挂着题，断言它们的题一题都不出现在定级里。只断言「题来自有题的关卡」
 *    的话，拿全库随机抽的实现照样绿。
 *
 * 2. **悄悄写掌握度**。票面明文「定级过程本身不产生掌握度记录」。断言
 *    「接口返回 200」什么也证明不了；这里在整场定级前后各数一次
 *    `app.attempts` 与 `app.mastery` 的行数，断言两次相等，并且**正向对照**
 *    `app.placement_answers` 确实增长了 —— 否则「一条都没写」也可能是
 *    「整场定级压根没落库」。
 *
 * 3. **只给档位不给答案**。票面验收 4 要求学习者能复核系统有没有判错。
 *    这里逐题断言作答回执带 `correctAnswerText` 与解析，结果页的复核表
 *    带「你选了什么 / 正确答案是什么」。
 *
 * ## 为什么自种题池
 *
 * 真实开发库只有 13 个关卡 / 16 道题，且带题的叶知识点只有十余个。用它跑
 * 「8–18 题」「三个停止条件」会得到 3 道题就停（`no_more_items`）的结论，
 * 那是数据不足，不是实现。所以这里种 3 个「即将要学」的叶知识点 × 7 题 =
 * 21 道候选，覆盖 easy / medium / hard 三档。
 *
 * ## 关卡 spec 为什么可以很小
 *
 * 定级只从 `levels.spec.items[].kind` 读难度（fact/concept/comprehensive →
 * easy/medium/hard），不校验 spec 的完整性。这里仍然把 `items[].kind` 写全，
 * 并断言整场里出现**不止一种难度** —— 否则「难度全是 medium」在实现完全
 * 不读 spec 时也会绿。
 */

let app: INestApplication;
let schema: TestSchema;
let db: DatabaseService;

// ---------------------------------------------------------------------------
// 种子里「即将要学」的三个叶知识点（各 7 题）
// ---------------------------------------------------------------------------

interface SeededKp {
  id: string;
  name: string;
  ordinal: number;
}

const ELIGIBLE: SeededKp[] = [
  { id: 'kp-amp', name: '前置放大器', ordinal: 1 },
  { id: 'kp-noise', name: '噪声系数', ordinal: 2 },
  { id: 'kp-adc', name: '模数转换', ordinal: 3 },
];

/** 已掌握的知识点：它有题，但**不该**进定级题池（票面「马上要学」）。 */
const DONE_KP: SeededKp = { id: 'kp-done', name: '已经学完的采样定理', ordinal: 4 };

/** 非叶容器：它也有题，但掌握度只挂叶节点，它不该进题池。 */
const CONTAINER_KP: SeededKp = { id: 'kp-container', name: '运算放大器（章节容器）', ordinal: 5 };

const ITEMS_PER_KP = 7;
const OPTIONS = ['甲方案', '乙方案', '丙方案', '丁方案'];
const KINDS = ['fact', 'concept', 'comprehensive', 'concept', 'fact', 'comprehensive', 'concept'] as const;

/** itemId → 正确选项下标。接口不回答案，测试自己记着。 */
const correctIndexOf = new Map<string, number>();

function itemIdOf(kpId: string, index: number): string {
  return `${kpId}-item-${index}`;
}

interface SelfAssessmentQuestionBody {
  id: string;
  prompt: string;
  options: Array<{ id: string; label: string }>;
}

interface ItemBody {
  itemId: string;
  microKpId: string;
  microKpName: string;
  stem: string;
  options: string[];
  difficulty: 'easy' | 'medium' | 'hard';
}

interface SessionBody {
  sessionId: string;
  item: ItemBody | null;
  answered: number;
  correctCount: number;
  probabilities: number[];
  posteriorSd: number;
  stop: { stopped: boolean; reason: string | null };
  remainingItems: number;
}

interface AnswerBody {
  itemId: string;
  correct: boolean;
  correctAnswer: number | string;
  correctAnswerText: string;
  explanation: string | null;
  whyWrong: string | null;
  session: SessionBody;
}

interface ResultBody {
  sessionId: string;
  tier: 'P1' | 'P2' | 'P3';
  status: 'provisional';
  confidence: number;
  lowConfidence: boolean;
  probabilities: number[];
  answered: number;
  correctCount: number;
  stopReason: string | null;
  review: Array<{
    itemId: string;
    microKpId: string;
    stem: string;
    yourAnswerText: string;
    correctAnswerText: string;
    correct: boolean;
    difficulty: string;
  }>;
  rejudgeAfterAttempts: number;
  explanation: string;
}

interface StatusBody {
  tier: 'P1' | 'P2' | 'P3' | null;
  status: 'none' | 'provisional';
  placedAt: string | null;
  rejudgeAfterAttempts: number;
  attemptsSince: number;
  shouldRejudge: boolean;
  lastRejudge: RejudgeEventBody | null;
}

interface RejudgeEventBody {
  previousTier: 'P1' | 'P2' | 'P3';
  tier: 'P1' | 'P2' | 'P3';
  changed: boolean;
  attemptsSince: number;
  averageFirstTryRate: number | null;
  explanation: string;
  at: string;
}

interface RejudgeBody {
  tier: 'P1' | 'P2' | 'P3';
  previousTier: 'P1' | 'P2' | 'P3';
  changed: boolean;
  attemptsSince: number;
  averageFirstTryRate: number | null;
  explanation: string;
  placedAt: string;
}

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

  await db.query(`INSERT INTO ${schema.name}.subjects (id, name) VALUES ('nuclear', '核电子学')`);
  await db.query(
    `INSERT INTO ${schema.name}.modules (id, subject_id, name, tier, ordinal)
     VALUES ('m-signal', 'nuclear', '信号与噪声', 'A', 1)`,
  );

  const allKps = [...ELIGIBLE, DONE_KP, CONTAINER_KP];
  for (const kp of allKps) {
    const isLeaf = kp.id !== CONTAINER_KP.id;
    await db.query(
      `INSERT INTO ${schema.name}.knowledge_points (id, module_id, parent_id, name, is_leaf, depth, ordinal)
       VALUES ($1, 'm-signal', NULL, $2, $3, $4, $5)`,
      [kp.id, kp.name, isLeaf, isLeaf ? 2 : 1, kp.ordinal],
    );

    const levelId = `lv-${kp.id}`;
    const items = Array.from({ length: ITEMS_PER_KP }, (_, index) => ({
      id: itemIdOf(kp.id, index),
      kind: KINDS[index % KINDS.length],
    }));
    await db.query(
      `INSERT INTO ${schema.name}.levels (id, micro_kp_id, title, kind, ordinal, spec)
       VALUES ($1, $2, $3, 'quiz', 1, $4::jsonb)`,
      [levelId, kp.id, `${kp.name}练习`, JSON.stringify({ items })],
    );

    for (let index = 0; index < ITEMS_PER_KP; index += 1) {
      const itemId = itemIdOf(kp.id, index);
      const correct = index % OPTIONS.length;
      correctIndexOf.set(itemId, correct);
      await db.query(
        `INSERT INTO ${schema.name}.level_items
           (id, level_id, stem, options, answer, explain_correct, explain_wrong,
            misconception_tags, source_ref, variant_group, pool)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, '{}', $8, $9, 'practice')`,
        [
          itemId,
          levelId,
          `${kp.name}：这道题该选哪个方案？（第 ${index + 1} 题）`,
          JSON.stringify(OPTIONS),
          JSON.stringify(correct),
          `正确答案是「${OPTIONS[correct]}」，因为这一项满足量纲与带宽要求。`,
          `选「${OPTIONS[(correct + 1) % OPTIONS.length]}」是最常见的误判：它忽略了后级负载。`,
          `${kp.name}·习题 ${index + 1}`,
          `vg-${kp.id}-${index % 3}`,
        ],
      );
    }
  }

  // 已掌握的知识点：既要进 `mastery`（那是读接口看到的状态），也要有
  // `attempts` 证据（那是掌握度的**来源**）。
  //
  // 两个都要写，不是冗余：题池用 `attempts` 回放判断「是不是已经学完」，
  // 因为 `app.mastery` 是派生缓存 —— `mastery.service.ts` 里 `current`
  // 会随时间衰减，读列等于把「上次算的时刻」当成「现在」。只插 mastery
  // 不插 attempts 的库在真实环境里不存在：没有作答就没有 mastery 行。
  // 测试若只插 mastery，测的就是一个不可能出现的数据状态，
  // 而实现一旦从读列改成回放，这条题池用例会红。
  for (let index = 0; index < 8; index += 1) {
    await db.query(
      `INSERT INTO ${schema.name}.attempts
         (micro_kp_id, item_id, variant_group, correct, answer, knowledge_kind,
          counts_toward_mastery, created_at)
       VALUES ($1, $2, $3, true, '0'::jsonb, 'concept', true, now() - ($4 || ' minutes')::interval)`,
      [DONE_KP.id, itemIdOf(DONE_KP.id, index % 3), `vg-${DONE_KP.id}-${index % 3}`, String(240 - index)],
    );
  }
  await db.query(
    `INSERT INTO ${schema.name}.mastery
       (micro_kp_id, achieved, current, state, attempt_count, variant_count, evidence_sufficient)
     VALUES ($1, 0.92, 0.92, 'proficient', 12, 4, true)`,
    [DONE_KP.id],
  );
}, 60_000);

afterAll(async () => {
  await app?.close();
  await schema?.drop();
});

// ---------------------------------------------------------------------------
// 辅助：走接口，不直接调 Service
// ---------------------------------------------------------------------------

async function selfAssessmentForm(): Promise<{ questions: SelfAssessmentQuestionBody[]; rationale: string }> {
  const res = await request(app.getHttpServer()).get('/api/v1/placement/self-assessment').expect(200);
  assertMatchesContract('/api/v1/placement/self-assessment', 'get', 200, res.body);
  return res.body as never;
}

/**
 * 一份「中性」的自评：每题选中间的选项。
 *
 * 用中间项而不是最低项，是为了让先验接近均匀（engine 里 `priorSpread = 1.8`
 * 的设计意图就是「默认不预设任何人是什么档」）。若测试用最低项，后面
 * 「全错 → P1」的断言就会变成自评推的，而不是题目答出来的。
 */
async function neutralSelfAssessment(): Promise<Array<{ questionId: string; optionId: string }>> {
  const form = await selfAssessmentForm();
  return form.questions.map((question) => {
    const middle = question.options[Math.floor(question.options.length / 2)];
    if (!middle) throw new Error(`自评题 ${question.id} 没有选项`);
    return { questionId: question.id, optionId: middle.id };
  });
}

async function startSession(): Promise<SessionBody> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/placement/sessions')
    .send({ selfAssessment: await neutralSelfAssessment() })
    // 201 会让「拿到状态快照」被误读成「有资源被创建」，这里逐字断言 200
    .expect(200);
  assertMatchesContract('/api/v1/placement/sessions', 'post', 200, res.body);
  return res.body as SessionBody;
}

async function getSession(sessionId: string): Promise<SessionBody> {
  const res = await request(app.getHttpServer())
    .get(`/api/v1/placement/sessions/${sessionId}`)
    .expect(200);
  assertMatchesContract('/api/v1/placement/sessions/{sessionId}', 'get', 200, res.body);
  return res.body as SessionBody;
}

async function submitAnswer(sessionId: string, itemId: string, answer: number): Promise<AnswerBody> {
  const res = await request(app.getHttpServer())
    .post(`/api/v1/placement/sessions/${sessionId}/answers`)
    .send({ itemId, answer })
    .expect(200);
  assertMatchesContract('/api/v1/placement/sessions/{sessionId}/answers', 'post', 200, res.body);
  return res.body as AnswerBody;
}

async function getResult(sessionId: string): Promise<ResultBody> {
  const res = await request(app.getHttpServer())
    .get(`/api/v1/placement/sessions/${sessionId}/result`)
    .expect(200);
  assertMatchesContract('/api/v1/placement/sessions/{sessionId}/result', 'get', 200, res.body);
  return res.body as ResultBody;
}

interface DrainOutcome {
  answers: AnswerBody[];
  last: SessionBody;
  itemIds: string[];
}

/**
 * 一直答到会话结束。
 *
 * `mode` 决定答对还是答错；答错取 `(correct + 1) % 选项数`，保证必然错而不是
 * 「碰巧蒙对」—— 蒙对会让「全错 → P1」那条断言间歇性红。
 */
async function drain(session: SessionBody, mode: 'correct' | 'wrong'): Promise<DrainOutcome> {
  const answers: AnswerBody[] = [];
  const itemIds: string[] = [];
  let current = session;

  while (current.item !== null) {
    if (answers.length >= 25) {
      throw new Error('定级没有在 25 题内结束：停止条件可能失效了');
    }
    const item = current.item;
    const correct = correctIndexOf.get(item.itemId);
    if (correct === undefined) throw new Error(`测试不知道 ${item.itemId} 的答案`);
    const answer = mode === 'correct' ? correct : (correct + 1) % item.options.length;

    itemIds.push(item.itemId);
    const body = await submitAnswer(current.sessionId, item.itemId, answer);
    answers.push(body);
    current = body.session;
  }

  return { answers, last: current, itemIds };
}

async function status(): Promise<StatusBody> {
  const res = await request(app.getHttpServer()).get('/api/v1/placement').expect(200);
  assertMatchesContract('/api/v1/placement', 'get', 200, res.body);
  return res.body as StatusBody;
}

/**
 * 把「学习证据 + 定级档案」清回起点。
 *
 * 同一个测试文件里的用例共享一个 schema。上一条用例造出来的学习证据
 * （无论是 5 题还是 24 题）会让下一条用例的计数从非 0 起算 —— 重判可能
 * 已经自动结算掉了，`attempts_since` 基线与预期不符；更严重的是题池会
 * 把已学完的知识点排除干净，后面的 `startSession()` 直接 409「没题了」。
 * 单跑时又是绿的 —— 这是最典型的「测试之间借状态」。
 *
 * 连 `DONE_KP` 的种子证据一起删：那条证据是给「题池要排掉已掌握知识点」
 * 那条用例用的，而它一旦留下，就会成为全局唯一的「已学完知识点」，把
 * 后面每次重判的平均首轮正确率拉成 100% —— 于是只想验证门槛的用例
 * 会被扣上一顶「档位被上调」的帽子。需要它的用例自己重新造。
 */
async function resetPlacementState(): Promise<void> {
  await db.query(
    `DELETE FROM ${schema.name}.attempts WHERE micro_kp_id = ANY($1::text[])`,
    [[...ELIGIBLE, DONE_KP].map((kp) => kp.id)],
  );
  await db.query(`DELETE FROM ${schema.name}.placement_profile`);
}

/**
 * 造「答了几题」的真实学习证据（不保证任何知识点被算作学完）。
 *
 * 重判门槛的计数口径是**作答数**（spec.md:52 / :283 都是学 5 题），不是
 * 「学完几个知识点」。这个 helper 故意只往一个知识点里塞 5 道题：
 * `evidenceSufficient` 要求 8 题 + 3 变式，所以这里没有知识点会被算作
 * 「学完」—— 如果实现按知识点计数，门槛永远是 0，重判永远不触发。
 */
async function learnAttempts(count: number): Promise<void> {
  const kp = ELIGIBLE[0];
  if (!kp) throw new Error('没有候选知识点');
  for (let index = 0; index < count; index += 1) {
    await db.query(
      `INSERT INTO ${schema.name}.attempts
         (micro_kp_id, item_id, variant_group, correct, answer, knowledge_kind,
          counts_toward_mastery, created_at)
       VALUES ($1, $2, $3, true, '0'::jsonb, 'concept', true, now() - ($4 || ' minutes')::interval)`,
      [kp.id, itemIdOf(kp.id, index % 3), `vg-${kp.id}-${index % 3}`, String(120 - index)],
    );
  }
}

/**
 * 造「学完了 3 个知识点」的学习证据（每个 8 题 + 3 变式）。
 *
 * 直接插 `attempts`（不是插 `mastery`）：掌握度是派生值，重判读的是证据
 * 回放。每知识点 8 次作答、3 个变式，刚好越过 `MASTERY_MIN_ATTEMPTS=8`
 * 与 `MASTERY_MIN_VARIANTS=3` 两道门槛。
 */
async function learnThreeKnowledgePoints(): Promise<void> {
  for (const kp of ELIGIBLE) {
    for (let index = 0; index < 8; index += 1) {
      await db.query(
        `INSERT INTO ${schema.name}.attempts
           (micro_kp_id, item_id, variant_group, correct, answer, knowledge_kind,
            counts_toward_mastery, created_at)
         VALUES ($1, $2, $3, true, '0'::jsonb, 'concept', true, now() - ($4 || ' minutes')::interval)`,
        [kp.id, itemIdOf(kp.id, index % 3), `vg-${kp.id}-${index % 3}`, String(60 - index)],
      );
    }
  }
}

async function rowCount(table: string): Promise<number> {
  const rows = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${schema.name}.${table}`,
  );
  return rows[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------

describe('行为自评：只问做过什么，且不直接定档', () => {
  it('恰好 4 题，问的都是行为频率', async () => {
    const form = await selfAssessmentForm();
    expect(form.questions).toHaveLength(4);

    // 自陈式的「你觉得自己几分」是票面明令禁止的：自评与真实能力的关系
    // 不稳定，一题自评就定档等于把整个定级过程省掉了。
    //
    // 只扫**题目与选项**，不扫 `rationale`：说明里那句「不是让你给自己打分」
    // 恰恰是在解释这条规则，把它算成违规会让检查变成「谁解释规则谁违规」。
    // 这正是负向断言最容易出错的地方 —— 匹配到的是「声明不做某事」，而不是
    // 「做了某事」。所以下面还有一条正向对照：题目必须真的在问行为。
    const forbidden = ['你觉得自己', '几分', '什么水平', '水平如何', '你有多强', '自我评价', '给自己打分'];
    const corpus = form.questions
      .map((question) => [question.prompt, ...question.options.map((option) => option.label)].join('\n'))
      .join('\n');
    for (const word of forbidden) {
      expect(corpus).not.toContain(word);
    }
    expect(corpus).toMatch(/最近|做过|手算|用过|学过/);

    for (const question of form.questions) {
      expect(question.options.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('提交自评只回一个不超过半档的先验平移，不回档位', async () => {
    const answers = await neutralSelfAssessment();
    const res = await request(app.getHttpServer())
      .post('/api/v1/placement/self-assessment')
      .send({ answers })
      .expect(200);
    assertMatchesContract('/api/v1/placement/self-assessment', 'post', 200, res.body);

    const body = res.body as { priorShift: number; priorProbabilities: number[] };
    expect(Math.abs(body.priorShift)).toBeLessThanOrEqual(0.4);
    expect(body.priorProbabilities).toHaveLength(3);
    expect(body.priorProbabilities.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 10);
    // 自评不直接定档：响应里没有 tier 这类字段
    expect(Object.keys(body).sort()).toEqual(['priorProbabilities', 'priorShift']);
  });

  it('少答一题就拒绝，而不是替学生默认一个中间值', async () => {
    const answers = (await neutralSelfAssessment()).slice(0, 3);
    const res = await request(app.getHttpServer())
      .post('/api/v1/placement/self-assessment')
      .send({ answers })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.message).toContain('自评缺少');
  });

  it('不存在的选项 id 被拒绝', async () => {
    const answers = await neutralSelfAssessment();
    answers[0] = { questionId: answers[0]!.questionId, optionId: 'no-such-option' };
    const res = await request(app.getHttpServer())
      .post('/api/v1/placement/self-assessment')
      .send({ answers })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.message).toContain('不存在');
  });
});

describe('定级题池只来自「马上要学的知识点」', () => {
  it('题池大小等于可学知识点挂的题数，已掌握与非叶容器的题一道都不在里面', async () => {
    const session = await startSession();

    // 21 = 3 个可学叶知识点 × 7 题。若实现拿全库随机抽，这个数字会包含
    // kp-done / kp-container 的 14 道题（变成 35）。
    expect(session.remainingItems).toBe(ELIGIBLE.length * ITEMS_PER_KP);

    const eligibleKpIds = new Set(ELIGIBLE.map((kp) => kp.id));
    const seen = await drain(session, 'correct');
    expect(seen.itemIds.length).toBeGreaterThan(0);
    for (const itemId of seen.itemIds) {
      const kpId = itemId.slice(0, itemId.lastIndexOf('-item-'));
      expect(eligibleKpIds.has(kpId)).toBe(true);
      expect(kpId).not.toBe(DONE_KP.id);
      expect(kpId).not.toBe(CONTAINER_KP.id);
    }
  });

  it('题池不看 app.mastery 快照：只有快照行、没有作答证据的知识点仍在池里', async () => {
    // 这条守的是「canonical = attempts 回放」这条规矩。曾经的实现是
    // `LEFT JOIN mastery ... WHERE ms.state IN ('unseen','attempted')` ——
    // 读快照列决定谁能进题池。`app.mastery` 是派生缓存，`current` 会随时间
    // 衰减（`mastery.service.ts` 文件头），而快照的写入时机没人能保证。
    //
    // 造一个真实环境里不会出现的状态：把一个可学知识点标成 `mastered`
    // 但**一条 attempts 都没有**。读快照的实现会把它从题池里踢掉，回放
    // 的实现不会（没有证据 = 没学过 = 当然还要定级）。
    //
    // 这条用例之所以能说明问题，是因为「快照说是已掌握」和「证据说没学过」
    // 明确矛盾 —— 若两个判据都要读，结论就只能选一边。
    const SNAPSHOT_ONLY = ELIGIBLE[2]!; // kp-adc
    await db.query(
      `INSERT INTO ${schema.name}.mastery
         (micro_kp_id, achieved, current, state, attempt_count, variant_count, evidence_sufficient)
       VALUES ($1, 0.95, 0.95, 'mastered', 20, 5, true)
       ON CONFLICT (micro_kp_id) DO UPDATE SET state = 'mastered', achieved = 0.95, current = 0.95`,
      [SNAPSHOT_ONLY.id],
    );
    try {
      // 先证明这条 fixture 真的落库了 —— 否则下面的断言在插入失败时也会通过
      const marked = await db.query<{ state: string }>(
        `SELECT state FROM ${schema.name}.mastery WHERE micro_kp_id = $1`,
        [SNAPSHOT_ONLY.id],
      );
      expect(marked[0]?.state).toBe('mastered');

      const session = await startSession();
      // 21 这个数字本身就是判据，三种实现各自给出不同的值：
      //   · 只回放（正确）：21 = 3 个可学知识点 × 7 题（kp-done 因 8 条证据被淘汰，
      //     非叶容器因 is_leaf 被排除，kp-adc 因「没有证据」被保留）
      //   · 读快照：14 = 连 kp-adc 的 7 题一起被 `state='mastered'` 踢掉
      //   · 完全不筛：28 = kp-done 的 7 题也进来了
      expect(session.remainingItems).toBe(ELIGIBLE.length * ITEMS_PER_KP);
    } finally {
      await db.query(`DELETE FROM ${schema.name}.mastery WHERE micro_kp_id = $1`, [SNAPSHOT_ONLY.id]);
    }
  });

  it('第一道题带知识点名与难度，题面里没有答案', async () => {
    const session = await startSession();
    const item = session.item;
    expect(item).not.toBeNull();
    if (item === null) return;

    const seeded = ELIGIBLE.find((kp) => kp.id === item.microKpId);
    expect(seeded).toBeDefined();
    expect(item.microKpName).toBe(seeded?.name);
    expect(item.options).toEqual(OPTIONS);
    expect(item.stem.length).toBeGreaterThan(0);
    expect(['easy', 'medium', 'hard']).toContain(item.difficulty);

    // 定级中把答案发给前端就是开卷
    const raw = session.item as unknown as Record<string, unknown>;
    expect('answer' in raw).toBe(false);
    expect('explanation' in raw).toBe(false);
  });

  it('难度来自关卡 spec 的 kind，不是硬编码成同一档', async () => {
    // 只看「出现过不止一种难度」是不够的：把 21 道题按 id 奇偶分成两档也能过。
    // 这里逐题对上 `spec.items[].kind` → difficulty 的映射：
    // fact → easy、concept → medium、comprehensive → hard。
    const expected: Record<string, string> = { fact: 'easy', concept: 'medium', comprehensive: 'hard' };

    const session = await startSession();
    const { answers } = await drain(session, 'correct');
    const result = await getResult(session.sessionId);
    expect(result.review.length).toBeGreaterThanOrEqual(8);

    let checked = 0;
    for (const row of result.review) {
      const index = Number(row.itemId.slice(row.itemId.lastIndexOf('-item-') + 6));
      const kind = KINDS[index % KINDS.length]!;
      expect(row.difficulty).toBe(expected[kind]);
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(8);

    // 顺带证明这次定级真的覆盖了不止一档难度（否则上面的映射可能恰好只
    // 碰到一种 kind，逐题对上也不能说明映射被实现）
    const kinds = new Set(
      result.review.map((row) => KINDS[Number(row.itemId.slice(row.itemId.lastIndexOf('-item-') + 6)) % KINDS.length]),
    );
    expect(kinds.size).toBeGreaterThanOrEqual(2);
    expect(answers.length).toBeGreaterThan(0);
  });
});

describe('8–18 题与三个停止条件', () => {
  it('全对时会话在 8 题后停下，原因是后验收敛（sd）', async () => {
    const session = await startSession();
    const { last } = await drain(session, 'correct');

    expect(last.item).toBeNull();
    expect(last.stop.stopped).toBe(true);
    expect(last.stop.reason).toBe('sd');
    // 票面：题量落在 8–18 之间
    expect(last.answered).toBeGreaterThanOrEqual(8);
    expect(last.answered).toBeLessThanOrEqual(18);
    expect(last.posteriorSd).toBeLessThanOrEqual(0.35);
  });

  it('全错时同样不少于 8 题，且不会超过 18 题', async () => {
    const session = await startSession();
    const { last } = await drain(session, 'wrong');

    expect(last.item).toBeNull();
    expect(last.stop.stopped).toBe(true);
    expect(['sd', 'band', 'entropy', 'max_items', 'no_more_items']).toContain(last.stop.reason);
    expect(last.answered).toBeGreaterThanOrEqual(8);
    expect(last.answered).toBeLessThanOrEqual(18);
    expect(last.remainingItems).toBeGreaterThanOrEqual(0);
  });

  it('同一道题不会被问两次', async () => {
    const session = await startSession();
    const { itemIds } = await drain(session, 'wrong');
    expect(itemIds.length).toBeGreaterThanOrEqual(8);
    // 不重复是「后验在推进」的前提：重复同一题会让人以为自己没提交成功
    expect(new Set(itemIds).size).toBe(itemIds.length);
  });

  it('刷新页面能从服务端恢复进度（历史不在前端）', async () => {
    const session = await startSession();
    const first = session.item;
    expect(first).not.toBeNull();
    if (first === null) return;

    const correct = correctIndexOf.get(first.itemId) ?? 0;
    await submitAnswer(session.sessionId, first.itemId, correct);

    const restored = await getSession(session.sessionId);
    expect(restored.answered).toBe(1);
    expect(restored.correctCount).toBe(1);
    expect(restored.item?.itemId).not.toBe(first.itemId);
  });
});

describe('作答回执必须能让学习者复核', () => {
  it('每道题都回带正确答案、正确答案文本与解析', async () => {
    const session = await startSession();
    const first = session.item;
    expect(first).not.toBeNull();
    if (first === null) return;

    const wrongIndex = ((correctIndexOf.get(first.itemId) ?? 0) + 1) % first.options.length;
    const body = await submitAnswer(session.sessionId, first.itemId, wrongIndex);

    expect(body.correct).toBe(false);
    expect(typeof body.correctAnswer).toBe('number');
    expect(body.correctAnswerText).toBe(OPTIONS[correctIndexOf.get(first.itemId) ?? 0]);
    // 票面验收 4：只给对错不可复核
    expect(body.explanation).not.toBeNull();
    expect(body.explanation).toContain('量纲与带宽');
    expect(body.whyWrong).not.toBeNull();
    expect(body.whyWrong).toContain('后级负载');
  });

  it('判对时不回 whyWrong（不编造不存在的错误解释）', async () => {
    const session = await startSession();
    const first = session.item;
    if (first === null) throw new Error('会话没有起始题');
    const correct = correctIndexOf.get(first.itemId) ?? 0;
    const body = await submitAnswer(session.sessionId, first.itemId, correct);
    expect(body.correct).toBe(true);
    expect(body.whyWrong).toBeNull();
  });
});

describe('结果页', () => {
  it('逐题复核表列出你选了什么与正确答案，且标注 provisional', async () => {
    const session = await startSession();
    const { itemIds } = await drain(session, 'wrong');
    const result = await getResult(session.sessionId);

    expect(result.status).toBe('provisional');
    expect(['P1', 'P2', 'P3']).toContain(result.tier);
    expect(result.answered).toBe(itemIds.length);
    expect(result.review).toHaveLength(itemIds.length);
    expect(result.review.map((row) => row.itemId)).toEqual(itemIds);

    for (const row of result.review) {
      expect(row.stem.length).toBeGreaterThan(0);
      expect(row.correctAnswerText.length).toBeGreaterThan(0);
      expect(row.yourAnswerText.length).toBeGreaterThan(0);
      // 全错，所以「你选的」必须与「正确答案」不同
      expect(row.correct).toBe(false);
      expect(row.yourAnswerText).not.toBe(row.correctAnswerText);
    }

    // 说明里要引用具体数字，而不是一句「根据你的表现」
    expect(result.explanation).toContain(String(result.answered));
    expect(result.explanation).toContain('临时');
    // 门槛口径是题不是知识点：spec.md:52 / :283 都是「学 5 题」。
    // 结果页面向学习者写具体数字，不能硬编码一句「以后会自动重判」。
    expect(result.rejudgeAfterAttempts).toBe(5);
    expect(result.explanation).toContain('再答 5 题');
  });

  it('没答完就查结果会 409，而不是给一个还会变的档位', async () => {
    const session = await startSession();
    const res = await request(app.getHttpServer())
      .get(`/api/v1/placement/sessions/${session.sessionId}/result`)
      .expect(409);
    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.message).toContain('还没结束');
  });

  it('答完的会话再提交作答会 409', async () => {
    const session = await startSession();
    const { itemIds } = await drain(session, 'correct');
    const lastItem = itemIds[itemIds.length - 1];
    if (!lastItem) throw new Error('没有作答记录');
    const res = await request(app.getHttpServer())
      .post(`/api/v1/placement/sessions/${session.sessionId}/answers`)
      .send({ itemId: lastItem, answer: 0 })
      .expect(409);
    expect(res.body.code).toBe('CONFLICT');
  });
});

describe('定级不产生掌握度记录（票面验收 6）', () => {
  it('整场定级前后 attempts 与 mastery 行数完全相等，而 placement_answers 真的增长', async () => {
    const attemptsBefore = await rowCount('attempts');
    const masteryBefore = await rowCount('mastery');
    const placementBefore = await rowCount('placement_answers');

    const session = await startSession();
    const { itemIds } = await drain(session, 'wrong');
    await getResult(session.sessionId);

    // 正向对照：这次定级确实落了库、确实答了题
    expect(itemIds.length).toBeGreaterThanOrEqual(8);
    expect(await rowCount('placement_answers')).toBe(placementBefore + itemIds.length);

    // 关键断言：掌握度证据一条都没有多
    expect(await rowCount('attempts')).toBe(attemptsBefore);
    expect(await rowCount('mastery')).toBe(masteryBefore);
  });

  it('定级作答不会让知识点的掌握度状态变化', async () => {
    const before = await db.query<{ micro_kp_id: string; state: string }>(
      `SELECT micro_kp_id, state FROM ${schema.name}.mastery ORDER BY micro_kp_id`,
    );
    const session = await startSession();
    await drain(session, 'correct');
    const after = await db.query<{ micro_kp_id: string; state: string }>(
      `SELECT micro_kp_id, state FROM ${schema.name}.mastery ORDER BY micro_kp_id`,
    );
    expect(after).toEqual(before);
    expect(before).toHaveLength(1);
  });
});

describe('provisional 档位与「答满 5 题后自动重判」', () => {
  it('定级完成后状态是 provisional，作答数为 0 时不该重判', async () => {
    await resetPlacementState();
    const session = await startSession();
    const { last } = await drain(session, 'wrong');
    expect(last.item).toBeNull();

    const state = await status();
    expect(state.status).toBe('provisional');
    expect(['P1', 'P2', 'P3']).toContain(state.tier);
    expect(state.rejudgeAfterAttempts).toBe(5);
    expect(state.attemptsSince).toBe(0);
    expect(state.shouldRejudge).toBe(false);
    expect(state.placedAt).not.toBeNull();
    // 契约里 `placedAt` 是 z.string()，本地化的 `Date.toString()`（`Wed Oct 21
    // 2026 05:08:10 GMT+0800 (中国标准时间)`）也能过契约检查 —— Zod 只看类型。
    // 但前端 `new Date(...)` 在非 en-US 环境会解析失败或错位。断言它是 ISO，
    // 否则这类格式漂移只有到了浏览器里才发现。
    expect(state.placedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(Date.parse(state.placedAt as string))).toBe(false);
  });

  it('答了 4 题还不够，不会重判', async () => {
    await resetPlacementState();
    const session = await startSession();
    await drain(session, 'wrong');
    await learnAttempts(4);

    const state = await status();
    expect(state.attemptsSince).toBe(4);
    expect(state.shouldRejudge).toBe(false);
    expect(state.lastRejudge).toBeNull();
  });

  it('答满 5 题，只是读一次状态就已经重判过了（不需要点任何按钮）', async () => {
    await resetPlacementState();
    const session = await startSession();
    const { last } = await drain(session, 'wrong');
    expect(last.answered).toBeGreaterThanOrEqual(8);

    const afterPlacement = await status();
    expect(afterPlacement.shouldRejudge).toBe(false);
    expect(afterPlacement.lastRejudge).toBeNull();
    expect(afterPlacement.tier).toBe('P1');

    // 关键细节：这 5 题全塞进**同一个**知识点，而一个知识点要 8 题 + 3 变式
    // 才算「学完」。所以这 5 题过了门槛、但没有任何知识点被算作学完。
    //
    // 如果门槛写成「学完几个知识点 ≥ 3」这条会红（lastRejudge 仍是 null）：
    // 而那正是最初的实现 —— 它让重判在最初几天永远不触发，恰好是定级最
    // 容易判错的时间段。spec.md:52 与 :283 两处都是「学 5 题」。
    await learnAttempts(5);

    // 关键：这里只有一次 GET，没有任何写接口。票 11 验收 5 要求「**自动**
    // 重判」—— 如果实现是「等客户端记得点按钮」，这条也会红。
    const auto = await status();
    expect(auto.attemptsSince).toBe(0);
    expect(auto.shouldRejudge).toBe(false);
    expect(auto.lastRejudge).not.toBeNull();
    expect(auto.lastRejudge?.attemptsSince).toBe(5);
    // 证据只够给出门槛，不够算首轮正确率（没有知识点学完）→ 档位不变。
    // 这就是诚实的行为：不能因为「答了 5 题」就把人调档。
    expect(auto.lastRejudge?.averageFirstTryRate).toBeNull();
    expect(auto.lastRejudge?.changed).toBe(false);
    expect(auto.tier).toBe('P1');

    // 但「算不出」必须说清「那要等到什么时候」。只说「暂时算不出」的话，
    // 学习者明明答够了门槛却一动不动，看起来就是重判坏了 —— 这条断言守的是
    // 那句解释在不在，而不是数字对不对。
    const explanation = auto.lastRejudge?.explanation ?? '';
    expect(explanation).toContain('暂时算不出平均首轮正确率');
    expect(explanation).toContain('至少一个知识点达到「已熟练」');
    expect(explanation).toContain('8 题');
    expect(explanation).toContain('3 种变式');
    expect(explanation).toContain('在那之前档位保持不动');
    // 阴性对照：算不出正确率的时候不能说「这个表现与 P1 相符」——
    // 没有样本就没有「表现」，那是另一句假话。
    expect(explanation).not.toContain('这个表现与');

    // 自动重判是幂等的：再读一次不会又动一档
    const again = await status();
    expect(again.tier).toBe('P1');
    expect(again.lastRejudge?.tier).toBe('P1');
  });

  it('答够 5 题且首轮全对，档位往上调一档', async () => {
    await resetPlacementState();
    // 先完成一次定级。全错 → 落到 P1，于是「上调」有空间。
    const session = await startSession();
    const { last } = await drain(session, 'wrong');
    expect(last.answered).toBeGreaterThanOrEqual(8);

    const afterPlacement = await status();
    expect(afterPlacement.shouldRejudge).toBe(false);
    expect(afterPlacement.tier).toBe('P1');

    // 造真实学习证据：3 个知识点各 8 次作答、3 个变式、全对（24 题 ≥ 5）。
    // 直接插 attempts（不是插 mastery）：掌握度是派生值，重判读的是证据回放。
    await learnThreeKnowledgePoints();

    const auto = await status();
    expect(auto.tier).toBe('P2');
    expect(auto.shouldRejudge).toBe(false);
    // 基线已经前移，所以「自上次定级以来」归零
    expect(auto.attemptsSince).toBe(0);
    expect(auto.lastRejudge).not.toBeNull();
    // 档位变了却不解释，学习者会以为应用出错了
    expect(auto.lastRejudge?.previousTier).toBe('P1');
    expect(auto.lastRejudge?.tier).toBe('P2');
    expect(auto.lastRejudge?.changed).toBe(true);
    expect(auto.lastRejudge?.explanation).toContain('上调');
    expect(auto.lastRejudge?.attemptsSince).toBe(24);
    expect(auto.lastRejudge?.averageFirstTryRate).toBeCloseTo(1, 10);
  });

  it('手动重判走同一套规则：客户端拿着旧快照时也能显式触发', async () => {
    await resetPlacementState();
    const session = await startSession();
    await drain(session, 'wrong');
    const afterPlacement = await status();
    expect(afterPlacement.tier).toBe('P1');

    await learnThreeKnowledgePoints();

    // 刻意**不**先 GET 状态：那条路径会自动结算掉，之后手动重判只会得到
    // 409。这里测的是「客户端手里还是旧快照，直接显式触发」的情形。
    const res = await request(app.getHttpServer()).post('/api/v1/placement/rejudge').expect(200);
    assertMatchesContract('/api/v1/placement/rejudge', 'post', 200, res.body);
    const rejudged = res.body as RejudgeBody;

    expect(rejudged.previousTier).toBe('P1');
    expect(rejudged.changed).toBe(true);
    expect(rejudged.tier).toBe('P2');
    expect(rejudged.attemptsSince).toBe(24);
    expect(rejudged.averageFirstTryRate).toBeCloseTo(1, 10);
    expect(rejudged.explanation).toContain('上调');

    // 重判后基线前移：立刻再查一次就不该再要求重判
    const after = await status();
    expect(after.tier).toBe('P2');
    expect(after.shouldRejudge).toBe(false);
    expect(after.attemptsSince).toBe(0);
  });

  it('自动结算过之后再调手动重判是 409，两条路径共用同一条基线', async () => {
    // 票面要求的「自动重判」一旦发生，手动入口就该关着 —— 否则同一个门槛
    // 会被算两遍，档位连跳两级。
    if ((await status()).status === 'none') {
      const session = await startSession();
      await drain(session, 'wrong');
    }
    const before = await status();
    expect(before.attemptsSince).toBe(0);

    const res = await request(app.getHttpServer()).post('/api/v1/placement/rejudge').expect(409);
    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.message).toContain('还需要再答');
  });

  it('没答够就重判会 409，并说清还差几题', async () => {
    // 这一条自己保证前置状态：`-t` 单跑时上面那条重判用例不会先执行，
    // 库里就没有档位记录（`placement_profile` 是单行表，整个 schema 共享）。
    // 先补一次定级，断言 409 才是在测「作答数不够」而不是「没定过级」。
    if ((await status()).status === 'none') {
      const session = await startSession();
      await drain(session, 'wrong');
    }

    const res = await request(app.getHttpServer()).post('/api/v1/placement/rejudge').expect(409);
    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.message).toContain('还需要再答');
  });
});

describe('入参与状态错误', () => {
  // 这些用例都要 `startSession()`，而题池会把「已学完」的叶知识点排掉。
  // 上一条重判用例给三个可学知识点各造了 8 道题 —— 不清理的话这里
  // 每一条都会得到 409「现在还没有可以定级的题目」。
  beforeEach(async () => {
    await resetPlacementState();
  });

  it('不属于本次定级的题 404', async () => {
    const session = await startSession();
    const res = await request(app.getHttpServer())
      .post(`/api/v1/placement/sessions/${session.sessionId}/answers`)
      // 用非叶容器的题：容器永远进不了题池（不是可学知识点），
      // 所以不管前面的证据怎么变，这个断言都在测“不属于本次定级”。
      .send({ itemId: itemIdOf(CONTAINER_KP.id, 0), answer: 0 })
      .expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('选项下标越界 422，而不是当成判错', async () => {
    const session = await startSession();
    const item = session.item;
    if (item === null) throw new Error('会话没有起始题');
    const res = await request(app.getHttpServer())
      .post(`/api/v1/placement/sessions/${session.sessionId}/answers`)
      .send({ itemId: item.itemId, answer: 99 })
      .expect(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.message).toContain('超出这道题的选项个数');
  });

  it('不存在的会话 404', async () => {
    await request(app.getHttpServer()).get('/api/v1/placement/sessions/plc-nope').expect(404);
  });

  it('请求体不合法 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/placement/sessions')
      .send({ selfAssessment: [] })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});
