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

/**
 * 票 06：出口门控与解锁（集成）。
 *
 * 这一套刻意**不**通过内部函数断言，而是 POST 真实作答、再 POST 门控：
 * 「7/8 通过、6/8 不通过」这类边界如果不是从 `attempts` 表读出来的，
 * 就只是把引擎单测抄了一遍 —— 真正会出错的地方是「读错了哪些作答」
 * （深究段、别张关卡、同一题反复刷），那是引擎看不见的。
 */
describe('GatingController（集成）', () => {
  let app: INestApplication;
  let schema: TestSchema;
  let db: DatabaseService;

  /** 每道题的正确答案都是 0；答错就填 1。 */
  const CORRECT = 0;
  const WRONG = 1;

  function itemIdOf(levelId: string, index: number): string {
    return `i-${levelId}-${index}`;
  }

  /**
   * 题目关卡（meta.type='quiz'）的最小合法 spec：只有判定段与小结段。
   * 门控要考的正是判定段引用的题。
   */
  function specFor(levelId: string, microKpId: string, itemCount: number, gating: unknown) {
    const items = Array.from({ length: itemCount }, (_, index) => ({
      id: itemIdOf(levelId, index),
      kind: 'concept',
      stem: `${levelId} 第 ${index + 1} 题：布尔代数基本运算`,
      options: ['选项甲', '选项乙', '选项丙'],
      answer: CORRECT,
      variantGroup: `vg-${levelId}-${index}`,
      explainCorrect: '答对了：与运算的交换律。',
      explainWrong: '答错了：注意与运算与或运算的优先级。',
      misconceptionTags: ['交换律混淆'],
      sourceRef: '测试教材·第 2 章',
      pool: 'core',
      hintLadder: ['先看运算优先级'],
    }));
    return {
      schemaVersion: 1,
      meta: {
        id: levelId,
        microKpId,
        title: `${levelId} 判定关卡`,
        type: 'quiz',
        tier: 'P1',
        estimatedMinutes: 8,
        author: 'system',
        isEntry: true,
        nextLevelId: null,
      },
      sources: [{ ref: '测试教材', locator: null }],
      cards: [],
      steps: [
        {
          id: `s-${levelId}-quiz`,
          kind: 'quiz',
          title: '判定',
          cardIds: [],
          itemIds: items.map((item) => item.id),
          requiredCorrect: 0,
        },
        {
          id: `s-${levelId}-summary`,
          kind: 'summary',
          title: '小结',
          cardIds: [],
          itemIds: [],
          requiredCorrect: 0,
        },
      ],
      items,
      gating,
    };
  }

  const levels: {
    levelId: string;
    microKpId: string;
    itemCount: number;
    gating: { mode: 'none' | 'exit' | 'prereq'; itemCount: number; passCount: number };
  }[] = [
    // 章末出口：8 题 7 对通过
    {
      levelId: 'lv-gate-exit',
      microKpId: 'kp-gate-exit',
      itemCount: 8,
      gating: { mode: 'exit', itemCount: 8, passCount: 7 },
    },
    {
      levelId: 'lv-gate-exit-fail',
      microKpId: 'kp-gate-exit-fail',
      itemCount: 8,
      gating: { mode: 'exit', itemCount: 8, passCount: 7 },
    },
    // 高入度先修：10 题 9 对通过
    {
      levelId: 'lv-gate-hub',
      microKpId: 'kp-gate-hub',
      itemCount: 10,
      gating: { mode: 'prereq', itemCount: 10, passCount: 9 },
    },
    {
      levelId: 'lv-gate-hub-fail',
      microKpId: 'kp-gate-hub-fail',
      itemCount: 10,
      gating: { mode: 'prereq', itemCount: 10, passCount: 9 },
    },
    // 题量不足：8 题只做了 5 题
    {
      levelId: 'lv-gate-thin',
      microKpId: 'kp-gate-thin',
      itemCount: 8,
      gating: { mode: 'exit', itemCount: 8, passCount: 7 },
    },
    // 不设门控
    {
      levelId: 'lv-gate-none',
      microKpId: 'kp-gate-none',
      itemCount: 2,
      gating: { mode: 'none', itemCount: 2, passCount: 2 },
    },
    // 挡住 kp-gate-locked 的那道先修门，自己也有门控
    {
      levelId: 'lv-gate-pre',
      microKpId: 'kp-gate-pre',
      itemCount: 2,
      gating: { mode: 'exit', itemCount: 2, passCount: 2 },
    },
    // 被挡住的下游节点自己的关卡
    {
      levelId: 'lv-gate-locked',
      microKpId: 'kp-gate-locked',
      itemCount: 2,
      gating: { mode: 'exit', itemCount: 2, passCount: 2 },
    },
  ];

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

    await db.query(`INSERT INTO subjects (id, name) VALUES ('subj-gate', '门控测试学科')`);
    await db.query(
      `INSERT INTO modules (id, subject_id, name, tier, ordinal)
       VALUES ('mod-gate', 'subj-gate', '门控测试模块', 'A', 1)`,
    );
    for (const level of levels) {
      await db.query(
        `INSERT INTO knowledge_points (id, module_id, parent_id, name, is_leaf, depth, ordinal)
         VALUES ($1, 'mod-gate', NULL, $2, true, 0, 1)`,
        [level.microKpId, `${level.microKpId} 知识点`],
      );
    }
    // 下游节点必须先存在：先修边与解锁行都有指向 knowledge_points 的外键
    await db.query(
      `INSERT INTO knowledge_points (id, module_id, parent_id, name, is_leaf, depth, ordinal)
       VALUES ('kp-gate-down', 'mod-gate', NULL, '下游知识点', true, 0, 2)`,
    );
    // 先修边：kp-gate-exit → kp-gate-down（通过出口门后解锁）
    //         kp-gate-pre  → kp-gate-locked（没通过就一直锁着）
    await db.query(
      `INSERT INTO kp_edges (from_id, to_id, kind, evidence)
       VALUES ('kp-gate-exit', 'kp-gate-down', 'prereq', '测试教材·第 1 章'),
              ('kp-gate-pre', 'kp-gate-locked', 'prereq', '测试教材·第 1 章')`,
    );

    for (const level of levels) {
      const spec = specFor(level.levelId, level.microKpId, level.itemCount, level.gating);
      await db.query(
        `INSERT INTO levels (id, micro_kp_id, title, kind, ordinal, spec)
         VALUES ($1, $2, $3, 'quiz', 1, $4::jsonb)`,
        [level.levelId, level.microKpId, spec.meta.title, JSON.stringify(spec)],
      );
      for (let index = 0; index < level.itemCount; index += 1) {
        await db.query(
          `INSERT INTO level_items
             (id, level_id, stem, options, answer, explain_correct, explain_wrong,
              misconception_tags, source_ref, variant_group, pool)
           VALUES ($1, $2, $3, '["选项甲","选项乙","选项丙"]'::jsonb, '0'::jsonb,
                   '答对了：与运算的交换律。', '答错了：注意与运算与或运算的优先级。',
                   ARRAY['交换律混淆']::text[], '测试教材·第 2 章', $4, 'quiz')`,
          [
            itemIdOf(level.levelId, index),
            level.levelId,
            `${level.levelId} 第 ${index + 1} 题：布尔代数基本运算`,
            `vg-${level.levelId}-${index}`,
          ],
        );
      }
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await schema?.drop();
  });

  /** 依次作答这张关卡的前 `total` 道题，前 `correct` 道答对。 */
  async function answer(levelId: string, total: number, correct: number): Promise<void> {
    for (let index = 0; index < total; index += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/attempts')
        .send({ itemId: itemIdOf(levelId, index), answer: index < correct ? CORRECT : WRONG })
        .expect(200);
    }
  }

  function evaluateGate(levelId: string) {
    return request(app.getHttpServer()).post(`/api/v1/levels/${levelId}/gate`);
  }

  it('章末出口边界：7/8 通过，并解锁下游节点（刷新不丢）', async () => {
    await answer('lv-gate-exit', 8, 7);

    const res = await evaluateGate('lv-gate-exit').expect(200);
    assertMatchesContract('/api/v1/levels/{levelId}/gate', 'post', 200, res.body);

    expect(res.body.evaluation.verdict).toBe('passed');
    expect(res.body.evaluation.passed).toBe(true);
    expect(res.body.evaluation.correct).toBe(7);
    expect(res.body.evaluation.total).toBe(8);
    expect(res.body.evaluation.rule).toEqual({ itemCount: 8, passCount: 7 });
    // 判定用的题目要原样回报 —— 「为什么说我过了」必须可核对
    expect(res.body.evaluation.itemIds).toHaveLength(8);
    expect(res.body.evaluation.wrongItemIds).toEqual([itemIdOf('lv-gate-exit', 7)]);
    expect(res.body.unlockedNodeIds).toEqual(['kp-gate-down']);

    // 解锁是**状态**，不是事件：单独查一次库与接口，确认刷新不丢
    const rows = await db.query<{ node_id: string; prerequisite_id: string }>(
      `SELECT node_id, prerequisite_id FROM node_unlocks WHERE node_id = 'kp-gate-down'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.prerequisite_id).toBe('kp-gate-exit');

    const unlock = await request(app.getHttpServer())
      .get('/api/v1/nodes/kp-gate-down/unlock')
      .expect(200);
    assertMatchesContract('/api/v1/nodes/{microKpId}/unlock', 'get', 200, unlock.body);
    expect(unlock.body.unlocked).toBe(true);
    expect(unlock.body.blockers).toEqual([]);
  });

  it('章末出口边界：6/8 不通过，给出重讲路径且不解锁', async () => {
    await answer('lv-gate-exit-fail', 8, 6);

    const res = await evaluateGate('lv-gate-exit-fail').expect(200);
    expect(res.body.evaluation.verdict).toBe('failed');
    expect(res.body.evaluation.passed).toBe(false);
    expect(res.body.evaluation.correct).toBe(6);
    expect(res.body.evaluation.total).toBe(8);
    expect(res.body.evaluation.shortfall).toBe(1);
    expect(res.body.unlockedNodeIds).toEqual([]);

    // 不是一句「不合格」：要指向缺哪一块，并念出答错的题
    const remediation = res.body.evaluation.remediation;
    expect(remediation).not.toBeNull();
    expect(remediation.kind).toBe('practice');
    expect(remediation.microKpId).toBe('kp-gate-exit-fail');
    expect(remediation.message).toContain('还差 1 道');
    expect(remediation.message).toContain('第 7 题');

    const rows = await db.query(`SELECT 1 AS hit FROM node_unlocks WHERE prerequisite_id = 'kp-gate-exit-fail'`);
    expect(rows).toHaveLength(0);
  });

  it('高入度先修边界：9/10 通过', async () => {
    await answer('lv-gate-hub', 10, 9);

    const res = await evaluateGate('lv-gate-hub').expect(200);
    expect(res.body.evaluation.verdict).toBe('passed');
    expect(res.body.evaluation.rule).toEqual({ itemCount: 10, passCount: 9 });
    expect(res.body.evaluation.correct).toBe(9);
    expect(res.body.evaluation.total).toBe(10);
  });

  it('高入度先修边界：8/10 不通过', async () => {
    await answer('lv-gate-hub-fail', 10, 8);

    const res = await evaluateGate('lv-gate-hub-fail').expect(200);
    expect(res.body.evaluation.verdict).toBe('failed');
    expect(res.body.evaluation.shortfall).toBe(1);
    expect(res.body.evaluation.message).toContain('8/10');
  });

  it('题量不足时判 undetermined，而不是「通过」也不是「不及格」', async () => {
    await answer('lv-gate-thin', 5, 5);

    // 关内答错的题不会在这里产生门控事件：判定只在出口发生
    const before = await db.query(
      `SELECT 1 AS hit FROM learning_log WHERE micro_kp_id = 'kp-gate-thin' AND event LIKE 'gate!_%' ESCAPE '!'`,
    );
    expect(before).toHaveLength(0);

    const res = await evaluateGate('lv-gate-thin').expect(200);
    expect(res.body.evaluation.verdict).toBe('undetermined');
    expect(res.body.evaluation.reason).toBe('insufficient_items');
    expect(res.body.evaluation.passed).toBe(false);
    expect(res.body.evaluation.total).toBe(5);
    // 5 题全对时报「还差 3 道题要做」（8-5），不是「还差 2 道答对」（7-5）。
    // 这个数会被前端读成行动建议；答对缺口在那个场景里本来就是 0 缺口
    // （全对），报 2 会让学习者以为自己做错了什么。
    expect(res.body.evaluation.shortfall).toBe(3);
    expect(res.body.evaluation.message).toContain('题量不足');
    // 题量不足不是失败：不该给「回去重讲」的结论，也不该解锁
    expect(res.body.unlockedNodeIds).toEqual([]);
  });

  it('深究段（counts_toward_mastery=false）的作答不进门口成绩', async () => {
    // lv-gate-exit-fail 已经有 6 对 2 错。补一条「深究段答对」的痕迹：
    // 若门控把它算进去就变成 7/8，会从不及格翻成通过。
    await db.query(
      `INSERT INTO attempts
         (micro_kp_id, item_id, level_id, variant_group, correct, answer,
          attempt_no, counts_toward_mastery, knowledge_kind)
       VALUES ('kp-gate-exit-fail', $1, 'lv-gate-exit-fail', $2, true, '0'::jsonb,
               1, false, 'concept')`,
      [itemIdOf('lv-gate-exit-fail', 7), 'vg-lv-gate-exit-fail-7'],
    );

    const res = await evaluateGate('lv-gate-exit-fail').expect(200);
    expect(res.body.evaluation.correct).toBe(6);
    expect(res.body.evaluation.total).toBe(8);
    expect(res.body.evaluation.verdict).toBe('failed');
  });

  it('门控结果写进学习日志，可按关卡回看每次判定用了哪几题', async () => {
    const history = await request(app.getHttpServer())
      .get('/api/v1/levels/lv-gate-exit-fail/gate/history')
      .expect(200);
    assertMatchesContract('/api/v1/levels/{levelId}/gate/history', 'get', 200, history.body);

    expect(history.body.levelId).toBe('lv-gate-exit-fail');
    expect(history.body.evaluations.length).toBeGreaterThanOrEqual(1);
    // 新的在前：最近一次就是刚才那次 6/8
    const latest = history.body.evaluations[0];
    expect(latest.verdict).toBe('failed');
    expect(latest.correct).toBe(6);
    expect(latest.itemIds).toHaveLength(8);
    expect(latest.wrongItemIds).toHaveLength(2);
    // 历史里必须能看出「用了哪几题」，不是只有分数
    expect(latest.itemIds).toContain(itemIdOf('lv-gate-exit-fail', 0));

    // 别的关卡的历史不混进来
    const other = await request(app.getHttpServer())
      .get('/api/v1/levels/lv-gate-hub/gate/history')
      .expect(200);
    for (const evaluation of other.body.evaluations) {
      expect(evaluation.levelId).toBe('lv-gate-hub');
    }
  });

  it('不设门控的关卡：判 undetermined，不写日志、不解锁', async () => {
    await answer('lv-gate-none', 2, 2);

    const res = await evaluateGate('lv-gate-none').expect(200);
    expect(res.body.evaluation.verdict).toBe('undetermined');
    expect(res.body.evaluation.reason).toBe('no_gate_configured');
    expect(res.body.evaluation.passed).toBe(false);
    expect(res.body.unlockedNodeIds).toEqual([]);

    const logs = await db.query(
      `SELECT 1 AS hit FROM learning_log WHERE micro_kp_id = 'kp-gate-none'`,
    );
    expect(logs).toHaveLength(0);
  });

  it('未解锁的下游节点：进关返回 409（不是 403、不是 500），并说明被哪道门挡着', async () => {
    const unlock = await request(app.getHttpServer())
      .get('/api/v1/nodes/kp-gate-locked/unlock')
      .expect(200);
    expect(unlock.body.unlocked).toBe(false);
    expect(unlock.body.blockers).toHaveLength(1);
    expect(unlock.body.blockers[0].prerequisiteId).toBe('kp-gate-pre');
    expect(unlock.body.blockers[0].prerequisiteName).toBe('kp-gate-pre 知识点');
    expect(unlock.body.blockers[0].levelId).toBe('lv-gate-pre');
    expect(unlock.body.blockers[0].lastVerdict).toBeNull();

    const res = await evaluateGate('lv-gate-locked').expect(409);
    assertMatchesContract('/api/v1/levels/{levelId}/gate', 'post', 409, res.body);
    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.message).toContain('还没解锁');
    expect(res.body.message).toContain('kp-gate-pre 知识点');
    expect(res.body.details.blockers).toHaveLength(1);
  });

  it('未解锁节点的关卡入口也是 409：锁在入口上，不在判定那一步', async () => {
    // 只拦「评门控」不够：学习者点的是「进关卡」，如果那时给 200，页面会先渲染
    // 出整张卷子再报错，等于把没解锁的内容先发了出去。
    const blocked = await request(app.getHttpServer())
      .get('/api/v1/levels/lv-gate-locked')
      .expect(409);
    assertMatchesContract('/api/v1/levels/{levelId}', 'get', 409, blocked.body);
    expect(blocked.body.code).toBe('CONFLICT');
    expect(blocked.body.message).toContain('还没解锁');
    expect(blocked.body.details.blockers[0].prerequisiteId).toBe('kp-gate-pre');

    // 反例：同一次运行里，已解锁的关卡照旧 200 —— 否则上面那条可能只是
    // 「所有关卡都 409」这种更糟的 bug。
    const open = await request(app.getHttpServer())
      .get('/api/v1/levels/lv-gate-exit')
      .expect(200);
    expect(open.body.level.levelId).toBe('lv-gate-exit');
  });

  it('关卡与知识点不存在时返回 404', async () => {
    await evaluateGate('lv-没有这个关卡').expect(404);
    const unlock = await request(app.getHttpServer())
      .get('/api/v1/nodes/kp-没有这个知识点/unlock')
      .expect(404);
    expect(unlock.body.code).toBe('NOT_FOUND');
  });

  it('重复判定不会重复计分，也不会改写首次解锁时间', async () => {
    const first = await db.query<{ unlocked_at: Date }>(
      `SELECT unlocked_at FROM node_unlocks WHERE node_id = 'kp-gate-down'`,
    );
    const again = await evaluateGate('lv-gate-exit').expect(200);
    expect(again.body.evaluation.verdict).toBe('passed');
    // 第二次通过不是「新解锁」：界面不该再弹一次「刚开了新内容」
    expect(again.body.unlockedNodeIds).toEqual([]);

    const second = await db.query<{ unlocked_at: Date }>(
      `SELECT unlocked_at FROM node_unlocks WHERE node_id = 'kp-gate-down'`,
    );
    expect(second[0]?.unlocked_at.toISOString()).toBe(first[0]?.unlocked_at.toISOString());
  });
});
