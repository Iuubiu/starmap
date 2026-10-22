import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../db/database.service.js';
import { ScriptedLlm } from '../llm/scripted-llm.js';
import { LLM_PORT } from '../llm/llm.port.js';
import { createTestSchema, type TestSchema } from '../../test/test-schema.js';
import { assertMatchesContract } from '../../test/contract.js';
import { reviewPoolKind } from './repository.js';

/**
 * 票 07：掌握度复验与间隔排期。
 *
 * ## 这套测试刻意走「真实数据路径」
 *
 * 票 03 的交接备注留了一条假绿：四状态里的「需复验」当时只靠 e2e 的
 * `page.route` 桩数据验证过，真实数据路径从未跑过。本套件里
 * `图谱的「需复验」与复验队列用的是同一列` 那条用例补的就是这个洞 ——
 * 它从**作答**开始，让 `ensureInitialReviewSchedule` 自己落下排期，把
 * `next_review_at` 拨到过去，然后调 `GET /api/v1/graph` 断言该节点
 * `reviewDueAt` 非空，再调 `GET /api/v1/review/queue` 断言同一批节点在列。
 *
 * ## 为什么 mastery 行不是手插的
 *
 * 「已掌握」这个状态只能靠证据回放得到（8 次作答 + 3 个变式）。手插一行
 * `state='mastered'` 会让测试跳过被验的那段逻辑 —— 而复验的全部意义就是
 * 「对已经真的掌握的东西再考一次」。
 */
describe('ReviewController（集成，票 07）', () => {
  let app: INestApplication;
  let schema: TestSchema;
  let db: DatabaseService;

  /** 两个知识点：rv-a 三题三个变式组，rv-b 三题三个变式组。 */
  const KPS = ['kp-rv-a', 'kp-rv-b'] as const;

  function specFor(microKpId: string, itemIds: string[], kinds: Record<string, string>) {
    return {
      schemaVersion: 1,
      meta: {
        id: `lv-${microKpId}`,
        microKpId,
        title: `${microKpId} 的复验池关卡`,
        type: 'quiz',
        tier: 'P1',
        estimatedMinutes: 10,
        author: 'system',
        isEntry: true,
        nextLevelId: null,
      },
      sources: [{ ref: '测试教材', locator: null }],
      cards: [
        { id: 'c-1', title: '测试卡', body: '测试正文'.repeat(20), figureRef: null },
      ],
      steps: [
        { id: 's-guide', kind: 'guide', title: '引导', cardIds: ['c-1'], itemIds: [], requiredCorrect: 0 },
        { id: 's-quiz', kind: 'quiz', title: '判定', cardIds: [], itemIds, requiredCorrect: 0 },
        { id: 's-summary', kind: 'summary', title: '小结', cardIds: [], itemIds: [], requiredCorrect: 0 },
      ],
      items: itemIds.map((id) => ({
        id,
        kind: kinds[id] ?? 'concept',
        stem: `${id} 的题干`,
        options: ['选项甲', '选项乙', '选项丙'],
        answer: 0,
        variantGroup: `vg-${id}`,
        explainCorrect: `${id} 答对了的预写反馈`,
        explainWrong: `${id} 答错了的预写反馈`,
        misconceptionTags: ['测试错因'],
        sourceRef: '测试教材·p.1',
        pool: 'core',
        hintLadder: ['提示一'],
      })),
      gating: { mode: 'none', itemCount: 3, passCount: 3 },
    };
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

    await db.query(`INSERT INTO subjects (id, name) VALUES ('subj-rv', '复验测试学科')`);
    await db.query(
      `INSERT INTO modules (id, subject_id, name, tier, ordinal)
       VALUES ('mod-rv', 'subj-rv', '复验测试模块', 'A', 1)`,
    );

    for (const microKpId of KPS) {
      await db.query(
        `INSERT INTO knowledge_points (id, module_id, parent_id, name, is_leaf, depth, ordinal)
         VALUES ($1, 'mod-rv', NULL, $2, true, 0, 1)`,
        [microKpId, `${microKpId} 知识点`],
      );

      const itemIds = [`${microKpId}-i1`, `${microKpId}-i2`, `${microKpId}-i3`];
      const spec = specFor(microKpId, itemIds, {
        [`${microKpId}-i1`]: 'fact',
        [`${microKpId}-i2`]: 'concept',
        [`${microKpId}-i3`]: 'comprehensive',
      });
      await db.query(
        `INSERT INTO levels (id, micro_kp_id, title, kind, ordinal, spec)
         VALUES ($1, $2, $3, 'quiz', 1, $4::jsonb)`,
        [`lv-${microKpId}`, microKpId, `${microKpId} 复验池`, JSON.stringify(spec)],
      );
      for (const itemId of itemIds) {
        await db.query(
          `INSERT INTO level_items
             (id, level_id, stem, options, answer, explain_correct, explain_wrong,
              misconception_tags, source_ref, variant_group, pool)
           VALUES ($1, $2, $3, '["选项甲","选项乙","选项丙"]'::jsonb, '0'::jsonb,
                   $4, $5, ARRAY['测试错因']::text[], '测试教材·p.1', $6, 'quiz')`,
          [itemId, `lv-${microKpId}`, `${itemId} 的题干`, `${itemId} 答对了的预写反馈`, `${itemId} 答错了的预写反馈`, `vg-${itemId}`],
        );
      }
    }

    // 「已掌握」只能靠证据拿到：每个知识点 3 个变式 × 3 轮 = 9 次全对。
    for (const microKpId of KPS) {
      for (let round = 0; round < 3; round += 1) {
        for (const suffix of ['i1', 'i2', 'i3']) {
          await request(app.getHttpServer())
            .post('/api/v1/attempts')
            .send({ itemId: `${microKpId}-${suffix}`, answer: 0 })
            .expect(200);
        }
      }
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await schema?.drop();
  });

  function queue() {
    return request(app.getHttpServer()).get('/api/v1/review/queue');
  }

  function graph() {
    return request(app.getHttpServer()).get('/api/v1/graph');
  }

  /** 把某个知识点的排期拨到过去，模拟「时间到了」。 */
  async function makeDue(microKpId: string, daysAgo = 2): Promise<void> {
    await db.query(
      `UPDATE mastery SET next_review_at = now() - ($2 || ' days')::interval
        WHERE micro_kp_id = $1`,
      [microKpId, String(daysAgo)],
    );
  }

  it('掌握之后自动落下第一次复验排期：1 天后（不是「打开页面才开始计时」）', async () => {
    const rows = await db.query<{ next_review_at: Date | null; review_stage: number }>(
      `SELECT next_review_at, review_stage FROM mastery WHERE micro_kp_id = 'kp-rv-a'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.next_review_at).not.toBeNull();
    expect(rows[0]?.review_stage).toBe(0);

    const dueAt = rows[0]?.next_review_at as Date;
    const masteredAt = await db.query<{ at: Date }>(
      `SELECT max(created_at) AS at FROM attempts WHERE micro_kp_id = 'kp-rv-a'`,
    );
    const gapDays = (dueAt.getTime() - (masteredAt[0]?.at as Date).getTime()) / 86_400_000;
    // 1 天档；容差 1 分钟（两次 now() 之间的真实耗时）
    expect(gapDays).toBeGreaterThan(1 - 1 / 1440);
    expect(gapDays).toBeLessThan(1 + 1 / 1440);
  });

  it('图谱的「需复验」与复验队列用的是同一列（补票 03 的假绿）', async () => {
    // 还没到期时：图谱 reviewDueAt 是未来，队列里没有
    const beforeGraph = await graph().expect(200);
    const beforeNodes = beforeGraph.body.nodes.filter(
      (node: { microKpId: string }) => (KPS as readonly string[]).includes(node.microKpId),
    );
    expect(beforeNodes).toHaveLength(2);
    for (const node of beforeNodes) {
      expect(node.reviewDueAt).not.toBeNull();
    }

    // 拨到过去 → 图谱与队列同时认为「到期」
    await makeDue('kp-rv-a');
    await makeDue('kp-rv-b');

    const afterGraph = await graph().expect(200);
    const now = Date.now();
    for (const microKpId of KPS) {
      const node = afterGraph.body.nodes.find(
        (candidate: { microKpId: string }) => candidate.microKpId === microKpId,
      );
      expect(node.reviewDueAt).not.toBeNull();
      // 这是「需复验」在画布上的真实判据（apps/web/src/graph/status.ts 逐字同一条）
      expect(Date.parse(node.reviewDueAt)).toBeLessThanOrEqual(now);
    }

    const res = await queue().expect(200);
    assertMatchesContract('/api/v1/review/queue', 'get', 200, res.body);
    const dueIds = res.body.due.map((entry: { microKpId: string }) => entry.microKpId);
    expect(dueIds).toEqual(['kp-rv-a', 'kp-rv-b']);
    for (const entry of res.body.due) {
      expect(entry.overdueDays).toBeGreaterThanOrEqual(1);
      expect(entry.availableItemCount).toBe(3);
      expect(entry.reviewStage).toBe(0);
      // 间隔天数由后端下发（唯一真源是 engine 的 REVIEW_INTERVALS_DAYS）：
      // 前端不重复抄一份序列，否则改间隔时两边会漂移。
      expect(entry.intervalDays).toBe(1);
    }

    // 反向：队列说没有的时候，图谱也必须说没有（不许出现「抽考说没有、图谱说有」）
    await db.query(`UPDATE mastery SET next_review_at = now() + interval '10 days'`);
    const futureGraph = await graph().expect(200);
    for (const microKpId of KPS) {
      const node = futureGraph.body.nodes.find(
        (candidate: { microKpId: string }) => candidate.microKpId === microKpId,
      );
      expect(Date.parse(node.reviewDueAt)).toBeGreaterThan(Date.now());
    }
    const empty = await queue().expect(200);
    expect(empty.body.due).toEqual([]);

    await makeDue('kp-rv-a');
    await makeDue('kp-rv-b');
  });

  it('抽到的题单 3–5 题，多个知识点交错出现而不是同一个连考', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/review/rounds').expect(200);
    assertMatchesContract('/api/v1/review/rounds', 'post', 200, res.body);

    const items = res.body.items as { ordinal: number; microKpId: string; itemId: string }[];
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.length).toBeLessThanOrEqual(5);
    expect(items.map((item) => item.ordinal)).toEqual(items.map((_, index) => index + 1));

    // 交错：相邻两道题来自不同知识点
    for (let index = 1; index < items.length; index += 1) {
      expect(items[index]?.microKpId).not.toBe(items[index - 1]?.microKpId);
    }
    // 覆盖两个知识点（不是只考一个）
    expect(new Set(items.map((item) => item.microKpId)).size).toBe(2);

    // 题目带正文与预写反馈，但不带答案
    for (const item of res.body.items) {
      expect(item.stem.length).toBeGreaterThan(0);
      expect(item.options).toHaveLength(3);
      expect(item.explainCorrect.length).toBeGreaterThan(0);
      expect(item.explainWrong.length).toBeGreaterThan(0);
      expect(item).not.toHaveProperty('answer');
    }

    // 题单落库，刷新后还能读回同一份
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/review/rounds/${res.body.round.roundId}`)
      .expect(200);
    assertMatchesContract('/api/v1/review/rounds/{roundId}', 'get', 200, detail.body);
    expect(detail.body.items.map((item: { itemId: string }) => item.itemId)).toEqual(
      items.map((item) => item.itemId),
    );
    expect(detail.body.round.verdict).toBeNull();
  });

  it('判分之前没答完不能判（422 并列出缺哪几道）', async () => {
    const started = await request(app.getHttpServer()).post('/api/v1/review/rounds').expect(200);
    const roundId = started.body.round.roundId as string;

    const res = await request(app.getHttpServer())
      .post(`/api/v1/review/rounds/${roundId}/complete`)
      .expect(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.missingItemIds).toHaveLength(started.body.items.length);
  });

  it('通过则推进到下一个间隔，未通过则退回更早的间隔（按知识点分别判）', async () => {
    const started = await request(app.getHttpServer()).post('/api/v1/review/rounds').expect(200);
    const roundId = started.body.round.roundId as string;
    const items = started.body.items as { itemId: string; microKpId: string }[];

    // kp-rv-a 全答错、kp-rv-b 全答对：一个知识点退档不该拖累另一个
    for (const item of items) {
      const wrong = item.microKpId === 'kp-rv-a';
      await request(app.getHttpServer())
        .post('/api/v1/attempts')
        .send({ itemId: item.itemId, answer: wrong ? 1 : 0, reviewRoundId: roundId })
        .expect(200);
    }

    const res = await request(app.getHttpServer())
      .post(`/api/v1/review/rounds/${roundId}/complete`)
      .expect(200);
    assertMatchesContract('/api/v1/review/rounds/{roundId}/complete', 'post', 200, res.body);

    const outcomes = res.body.outcomes as {
      microKpId: string;
      passed: boolean;
      stage: number;
      nextDueAt: string;
      correct: number;
      total: number;
    }[];
    const a = outcomes.find((outcome) => outcome.microKpId === 'kp-rv-a');
    const b = outcomes.find((outcome) => outcome.microKpId === 'kp-rv-b');
    expect(a?.passed).toBe(false);
    expect(b?.passed).toBe(true);

    // kp-rv-a：0 档未通过仍是 0 档（1 天）；kp-rv-b：0 → 1 档（3 天）
    expect(a?.stage).toBe(0);
    expect(b?.stage).toBe(1);

    const completedAt = Date.parse(res.body.round.completedAt as string);
    const gapA = (Date.parse(a?.nextDueAt as string) - completedAt) / 86_400_000;
    const gapB = (Date.parse(b?.nextDueAt as string) - completedAt) / 86_400_000;
    expect(gapA).toBeCloseTo(1, 2);
    expect(gapB).toBeCloseTo(3, 2);

    expect(res.body.round.verdict).toBe('failed');
  });

  it('未通过时 current 被下调而 achieved 一动不动（验收第 3 条）', async () => {
    // 上一轮 kp-rv-a 全错，此刻的掌握度里 achieved 应仍是历史最高
    const before = await db.query<{ achieved: string; current: string; state: string }>(
      `SELECT achieved, current, state FROM mastery WHERE micro_kp_id = 'kp-rv-a'`,
    );
    const beforeAchieved = Number(before[0]?.achieved);
    const beforeCurrent = Number(before[0]?.current);
    expect(beforeAchieved).toBeGreaterThan(0);

    await makeDue('kp-rv-a');
    const started = await request(app.getHttpServer()).post('/api/v1/review/rounds').expect(200);
    const roundId = started.body.round.roundId as string;
    const aItems = (started.body.items as { itemId: string; microKpId: string }[]).filter(
      (item) => item.microKpId === 'kp-rv-a',
    );
    expect(aItems.length).toBeGreaterThan(0);

    for (const item of aItems) {
      await request(app.getHttpServer())
        .post('/api/v1/attempts')
        .send({ itemId: item.itemId, answer: 2, reviewRoundId: roundId })
        .expect(200);
    }
    const res = await request(app.getHttpServer())
      .post(`/api/v1/review/rounds/${roundId}/complete`)
      .expect(200);

    const mastery = (res.body.mastery as { microKpId: string; achieved: number; current: number }[]).find(
      (entry) => entry.microKpId === 'kp-rv-a',
    );
    expect(mastery).toBeDefined();
    // achieved 是历史最高后验：任何下调路径都不碰它
    expect(mastery?.achieved).toBeCloseTo(beforeAchieved, 4);
    expect(mastery?.current).toBeLessThan(beforeCurrent);

    // 库里也一样（不是只在响应里拼出来的数字）
    const rows = await db.query<{ achieved: string; current: string }>(
      `SELECT achieved, current FROM mastery WHERE micro_kp_id = 'kp-rv-a'`,
    );
    expect(Number(rows[0]?.achieved)).toBeCloseTo(beforeAchieved, 4);
    expect(Number(rows[0]?.current)).toBeLessThan(beforeCurrent);
  });

  it('复验结果与普通作答共用同一套 BKT 更新路径（attempts 落库、knowledge_kind 来自 spec）', async () => {
    const rows = await db.query<{
      review_round_id: string | null;
      counts_toward_mastery: boolean;
      knowledge_kind: string;
      attempt_no: number;
    }>(
      `SELECT review_round_id, counts_toward_mastery, knowledge_kind, attempt_no
         FROM attempts
        WHERE review_round_id IS NOT NULL
        ORDER BY id ASC`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.counts_toward_mastery).toBe(true);
      expect(['fact', 'concept', 'comprehensive']).toContain(row.knowledge_kind);
      // 同一道题被复验再考一次，attempt_no 继续递增 —— 走的是同一条 INSERT
      expect(row.attempt_no).toBeGreaterThan(1);
    }
  });

  it('判分幂等：重复判分返回同一份结果，排期不再推第二档', async () => {
    await makeDue('kp-rv-b', 9);
    const started = await request(app.getHttpServer()).post('/api/v1/review/rounds').expect(200);
    const roundId = started.body.round.roundId as string;
    for (const item of started.body.items as { itemId: string }[]) {
      await request(app.getHttpServer())
        .post('/api/v1/attempts')
        .send({ itemId: item.itemId, answer: 0, reviewRoundId: roundId })
        .expect(200);
    }

    const first = await request(app.getHttpServer())
      .post(`/api/v1/review/rounds/${roundId}/complete`)
      .expect(200);
    const second = await request(app.getHttpServer())
      .post(`/api/v1/review/rounds/${roundId}/complete`)
      .expect(200);

    expect(second.body.outcomes).toEqual(first.body.outcomes);
    expect(second.body.round).toEqual(first.body.round);

    // 排期只推进了一档（stage 2），不是两档
    const rows = await db.query<{ review_stage: number }>(
      `SELECT review_stage FROM mastery WHERE micro_kp_id = 'kp-rv-b'`,
    );
    expect(rows[0]?.review_stage).toBe(2);
  });

  it('复验作答必须认领真实的会话与题单（422，不污染证据）', async () => {
    await makeDue('kp-rv-a', 1);
    const started = await request(app.getHttpServer()).post('/api/v1/review/rounds').expect(200);
    const roundId = started.body.round.roundId as string;

    // ① 会话不存在
    const bogus = await request(app.getHttpServer())
      .post('/api/v1/attempts')
      .send({ itemId: 'kp-rv-a-i1', answer: 0, reviewRoundId: 'round-does-not-exist' })
      .expect(422);
    expect(bogus.body.code).toBe('VALIDATION_FAILED');

    // ② 题目不在这轮题单里：拿一道不在本轮清单里的题冒充
    const roundItems = (started.body.items as { itemId: string }[]).map((item) => item.itemId);
    const outsider = await db.query<{ id: string }>(
      `SELECT id FROM level_items
        WHERE id <> ALL($1::text[])
        LIMIT 1`,
      [roundItems],
    );
    const outsiderId = outsider[0]?.id as string;
    expect(outsiderId).toBeTruthy();

    const before = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM attempts WHERE item_id = $1`,
      [outsiderId],
    );
    const notInRound = await request(app.getHttpServer())
      .post('/api/v1/attempts')
      .send({ itemId: outsiderId, answer: 0, reviewRoundId: roundId })
      .expect(422);
    expect(notInRound.body.code).toBe('VALIDATION_FAILED');

    // 两次失败都不该往证据里塞任何一行
    const after = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM attempts WHERE item_id = $1`,
      [outsiderId],
    );
    expect(after[0]?.count).toBe(before[0]?.count);
  });

  it('到期但题池里没有可用题时返回 409 而不是空题单', async () => {
    // 「没有可用题」的成因不是「全是 practice」—— 那是回退路径，见下一条用例。
    // 真正的「没有可用题」是「题目的类型读不出来」：knowledge_kind 只能从
    // `levels.spec.items` 里读（level_items 表没有这一列），读不到的题会被
    // 回落成 concept、半衰期就蒙错了，所以这种题不进复验。
    const itemIds = ['kp-rv-a-i1', 'kp-rv-a-i2', 'kp-rv-a-i3'];
    const kinds = {
      'kp-rv-a-i1': 'fact',
      'kp-rv-a-i2': 'concept',
      'kp-rv-a-i3': 'comprehensive',
    };
    const healthy = specFor('kp-rv-a', itemIds, kinds);
    const broken = specFor('kp-rv-a', itemIds, kinds);
    broken.items = [];

    await db.query(`UPDATE mastery SET next_review_at = now() + interval '30 days'`);
    await makeDue('kp-rv-a');
    await db.query(`UPDATE levels SET spec = $1::jsonb WHERE id = 'lv-kp-rv-a'`, [
      JSON.stringify(broken),
    ]);

    try {
      // 队列本身要诚实：它在列，但可复验的题是 0 道
      const listed = await queue().expect(200);
      const entry = (
        listed.body.due as Array<{ microKpId: string; availableItemCount: number }>
      ).find((row) => row.microKpId === 'kp-rv-a');
      expect(entry?.availableItemCount).toBe(0);

      const before = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM review_rounds`,
      );
      const res = await request(app.getHttpServer()).post('/api/v1/review/rounds').expect(409);
      expect(res.body.code).toBe('CONFLICT');
      expect(res.body.message).toContain('没有可以复验的题');

      const after = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM review_rounds`,
      );
      expect(after[0]?.count).toBe(before[0]?.count);
    } finally {
      await db.query(`UPDATE levels SET spec = $1::jsonb WHERE id = 'lv-kp-rv-a'`, [
        JSON.stringify(healthy),
      ]);
    }
  });

  it('一道 core 题都没有的知识点回退到 practice 池，有 core 的不会混入练习题', async () => {
    // 真实库里的形态：AI 生成的关卡只进 practice 池（票 16 验收④的红线），
    // 所以有些知识点**一道 core 都没有**。对它们只取 core 的结果不是「保证
    // 复验质量」，而是「永远无法复验」。所以：有 core 用 core，全无 core 才回退。
    //
    // kp-rv-a：留 i1/i2 在 core，把 i3 转成 practice —— 它绝不该被抽到；
    // kp-rv-b：三道全转 practice —— 回退路径，应该抽得出来。
    await db.query(`UPDATE level_items SET pool = 'practice' WHERE id = 'kp-rv-a-i3'`);
    await db.query(`UPDATE level_items SET pool = 'practice' WHERE id LIKE 'kp-rv-b-%'`);
    await db.query(`UPDATE mastery SET next_review_at = now() + interval '30 days'`);
    await makeDue('kp-rv-a');
    await makeDue('kp-rv-b');

    try {
      const started = await request(app.getHttpServer()).post('/api/v1/review/rounds').expect(200);
      const items = started.body.items as Array<{ itemId: string; microKpId: string }>;
      const fromA = items.filter((item) => item.microKpId === 'kp-rv-a').map((item) => item.itemId);
      const fromB = items.filter((item) => item.microKpId === 'kp-rv-b').map((item) => item.itemId);

      // 回退路径真的抽出了题（这正是修复前 409 的那批知识点）
      expect(fromB.length).toBeGreaterThan(0);
      // 有 core 的知识点只抽 core 题：i3 已被转成 practice，绝不该出现
      expect(fromA).not.toContain('kp-rv-a-i3');
      expect(fromA.every((id) => id === 'kp-rv-a-i1' || id === 'kp-rv-a-i2')).toBe(true);

      // 池的归属也可单独查：一个 core、一个回退
      const runner = (sql: string, params?: readonly unknown[]) => db.query(sql, params);
      expect(await reviewPoolKind(runner, 'kp-rv-a')).toBe('core');
      expect(await reviewPoolKind(runner, 'kp-rv-b')).toBe('practice-fallback');
    } finally {
      await db.query(`UPDATE level_items SET pool = 'quiz' WHERE id LIKE 'kp-rv-a-%'`);
      await db.query(`UPDATE level_items SET pool = 'quiz' WHERE id LIKE 'kp-rv-b-%'`);
    }
  });

  it('题池凑不满 3 题时返回 409，不开一轮判不准的复验', async () => {
    // 每个知识点只留 1 道 quiz：两个知识点加起来 2 题 < REVIEW_ITEMS_MIN(3)。
    // 2 题的复验哪怕全对也只会被判「通过」并推进一档间隔 —— 三题才叫复验，
    // 两题叫抽查。这条断言的是「宁可 409，也不开一轮判不准的会话」。
    await db.query(
      `UPDATE level_items SET pool = 'practice'
        WHERE (id LIKE 'kp-rv-a-%' AND id <> 'kp-rv-a-i1')
           OR (id LIKE 'kp-rv-b-%' AND id <> 'kp-rv-b-i1')`,
    );
    await makeDue('kp-rv-a');
    await makeDue('kp-rv-b');

    try {
      const before = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM review_rounds`,
      );

      const res = await request(app.getHttpServer()).post('/api/v1/review/rounds').expect(409);
      expect(res.body.code).toBe('CONFLICT');
      expect(res.body.message).toContain('3');

      // 而且这次拒绝没有落下任何一轮会话（拒绝发生在写库之前）。
      // 不能断言「总数是 0」—— 前面的用例已经开过几轮了。
      const after = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM review_rounds`,
      );
      expect(after[0]?.count).toBe(before[0]?.count);
    } finally {
      await db.query(
        `UPDATE level_items SET pool = 'quiz'
          WHERE id LIKE 'kp-rv-a-%' OR id LIKE 'kp-rv-b-%'`,
      );
    }
  });

  it('没有到期的复验时开始一轮返回 409（空队列是正常状态）', async () => {
    await db.query(`UPDATE mastery SET next_review_at = now() + interval '30 days'`);
    const empty = await queue().expect(200);
    expect(empty.body.due).toEqual([]);

    const res = await request(app.getHttpServer()).post('/api/v1/review/rounds').expect(409);
    expect(res.body.code).toBe('CONFLICT');
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message).toContain('没有到期');
  });

  it('复验结果写进学习日志，可回看用了哪几题', async () => {
    await makeDue('kp-rv-a', 3);
    const started = await request(app.getHttpServer()).post('/api/v1/review/rounds').expect(200);
    const roundId = started.body.round.roundId as string;
    for (const item of started.body.items as { itemId: string }[]) {
      await request(app.getHttpServer())
        .post('/api/v1/attempts')
        .send({ itemId: item.itemId, answer: 1, reviewRoundId: roundId })
        .expect(200);
    }
    const res = await request(app.getHttpServer())
      .post(`/api/v1/review/rounds/${roundId}/complete`)
      .expect(200);
    const outcome = (res.body.outcomes as { microKpId: string }[]).find(
      (entry) => entry.microKpId === 'kp-rv-a',
    );

    const logs = await db.query<{ event: string; payload: Record<string, unknown> }>(
      `SELECT event, payload FROM learning_log
        WHERE micro_kp_id = 'kp-rv-a' AND event IN ('review_passed', 'review_failed')
        ORDER BY id DESC LIMIT 1`,
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]?.event).toBe(outcome ? 'review_failed' : 'review_failed');
    expect(logs[0]?.payload['roundId']).toBe(roundId);
    expect(logs[0]?.payload['correctItemIds']).toBeInstanceOf(Array);
    expect(logs[0]?.payload['wrongItemIds']).toBeInstanceOf(Array);
    expect(logs[0]?.payload['intervalDays']).toBe(1);
  });
});
