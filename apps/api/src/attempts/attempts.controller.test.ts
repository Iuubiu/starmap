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
 * 票 05：作答记录与双字段掌握度。
 *
 * 这个套件按 TDD 写成：`同一 variant_group 两次作答后 variant_count 仍为 1`
 * 是先落盘的失败测试（当时 `apps/api/src/attempts/` 还不存在），实现跟上后
 * 才转绿。它对应的不是「代码碰巧算对了」，而是 ADR-0004 的那条裁定：
 * 变式数按 `variant_group` 去重，平行题不增加计数。
 */
describe('AttemptsController（集成）', () => {
  let app: INestApplication;
  let schema: TestSchema;
  let db: DatabaseService;

  /** 关卡 spec 只保留 run 需要的最小形状：steps 决定计分，items 决定类型。 */
  function specFor(steps: { id: string; kind: string; items: string[] }[], kinds: Record<string, string>) {
    return {
      schemaVersion: 1,
      meta: {
        id: 'lv-att',
        microKpId: 'kp-att',
        title: '作答测试关卡',
        type: 'teaching',
        tier: 'P1',
        estimatedMinutes: 10,
        author: 'system',
        isEntry: true,
        nextLevelId: null,
      },
      sources: [{ ref: '测试教材', locator: null }],
      cards: [{ id: 'c-1', title: '测试卡', body: '测试正文'.repeat(20), figureRef: null }],
      steps: steps.map((step) => ({
        id: step.id,
        kind: step.kind,
        title: step.kind,
        cardIds: step.kind === 'guide' ? ['c-1'] : [],
        itemIds: step.items,
        requiredCorrect: 0,
      })),
      items: Object.entries(kinds).map(([id, kind]) => ({
        id,
        kind,
        stem: `${id} 的题干`,
        options: ['选项甲', '选项乙', '选项丙'],
        answer: 0,
        variantGroup: `vg-${id}`,
        explainCorrect: '答对了的预写反馈',
        explainWrong: '答错了的预写反馈',
        misconceptionTags: ['测试错因'],
        sourceRef: '测试教材·p.1',
        pool: 'core',
        hintLadder: ['提示一'],
      })),
      gating: { mode: 'none', itemCount: 1, passCount: 1 },
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

    await db.query(`INSERT INTO subjects (id, name) VALUES ('subj-att', '作答测试学科')`);
    await db.query(
      `INSERT INTO modules (id, subject_id, name, tier, ordinal)
       VALUES ('mod-att', 'subj-att', '作答测试模块', 'A', 1)`,
    );
    await db.query(
      `INSERT INTO knowledge_points (id, module_id, parent_id, name, is_leaf, depth, ordinal)
       VALUES ('kp-att', 'mod-att', NULL, '作答测试知识点', true, 0, 1),
              ('kp-att-child', 'mod-att', 'kp-att', '子知识点', true, 0, 2)`,
    );
    // 父节点：用来验证非叶节点的聚合是只读派生
    await db.query(
      `UPDATE knowledge_points SET is_leaf = false WHERE id = 'kp-att'`,
    );

    const spec = specFor(
      [
        { id: 's-guide', kind: 'guide', items: [] },
        {
          id: 's-quiz',
          kind: 'quiz',
          items: ['i-att-a', 'i-att-b', 'i-att-c', 'i-att-d', 'i-att-practice'],
        },
        { id: 's-deepen', kind: 'deepen', items: ['i-att-deepen'] },
        { id: 's-summary', kind: 'summary', items: [] },
      ],
      {
        'i-att-a': 'concept',
        'i-att-b': 'concept',
        'i-att-c': 'concept',
        'i-att-d': 'fact',
        'i-att-practice': 'concept',
        'i-att-deepen': 'concept',
      },
    );
    // 深究段那道题在 spec 里标 practice，答了也不计分
    const practiceItem = spec.items.find((item) => item.id === 'i-att-practice');
    if (practiceItem) practiceItem.pool = 'practice';
    const deepenItem = spec.items.find((item) => item.id === 'i-att-deepen');
    if (deepenItem) deepenItem.pool = 'practice';

    await db.query(
      `INSERT INTO levels (id, micro_kp_id, title, kind, ordinal, spec)
       VALUES ('lv-att', 'kp-att-child', '作答测试', 'teach', 1, $1::jsonb)`,
      [JSON.stringify(spec)],
    );

    // i-att-a 与 i-att-b 是**平行题**：同组 vg-shared。这正是验收第 4 条的靶子。
    const items: [string, string, string, string, string][] = [
      ['i-att-a', 'vg-shared', 'quiz', 'concept', '答对了的预写反馈'],
      ['i-att-b', 'vg-shared', 'quiz', 'concept', '答对了的预写反馈'],
      ['i-att-c', 'vg-c', 'quiz', 'concept', '答对了的预写反馈'],
      ['i-att-d', 'vg-d', 'quiz', 'fact', '答对了的预写反馈'],
      ['i-att-practice', 'vg-p', 'practice', 'concept', '答对了的预写反馈'],
      ['i-att-deepen', 'vg-deepen', 'practice', 'concept', '答对了的预写反馈'],
    ];
    for (const [id, variantGroup, pool, kind, explainCorrect] of items) {
      await db.query(
        `INSERT INTO level_items
           (id, level_id, stem, options, answer, explain_correct, explain_wrong,
            misconception_tags, source_ref, variant_group, pool)
         VALUES ($1, 'lv-att', $2, '["选项甲","选项乙","选项丙"]'::jsonb, '0'::jsonb,
                 $3, '答错了的预写反馈', ARRAY['测试错因']::text[], '测试教材·p.1', $4, $5)`,
        [id, `${id} 的题干`, explainCorrect, variantGroup, pool],
      );
      void kind;
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await schema?.drop();
  });

  // 这里**不能**是 async：supertest 的 Test 是 thenable，async 函数返回它时
  // Promise 决议会把它同化（assimilate）成已完成的 Response，于是调用侧的
  // `submit(...).expect(200)` 就变成对 Response 调 .expect —— 报
  // `submit(...).expect is not a function`。要链式调用就必须原样交出 Test。
  function submit(body: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/api/v1/attempts').send(body);
  }

  it('同一 variant_group 两次作答后 variant_count 仍为 1（ADR-0004 去重）', async () => {
    const first = await submit({ itemId: 'i-att-a', answer: 0 }).expect(200);
    assertMatchesContract('/api/v1/attempts', 'post', 200, first.body);
    expect(first.body.mastery.variantCount).toBe(1);
    expect(first.body.mastery.attemptCount).toBe(1);

    // i-att-b 与被平行的 i-att-a 同组：换了道题，但没多会一个变式
    const second = await submit({ itemId: 'i-att-b', answer: 0 }).expect(200);
    expect(second.body.mastery.attemptCount).toBe(2);
    expect(second.body.mastery.variantCount).toBe(1);
  });

  it('作答落库后可回溯：题目、知识点、对错、用时、第几次都在', async () => {
    const res = await submit({
      itemId: 'i-att-c',
      answer: 2,
      stepId: 's-quiz',
      latencyMs: 12_345,
      hintsUsed: 1,
    }).expect(200);

    const attempt = res.body.attempt;
    assertMatchesContract('/api/v1/attempts', 'post', 200, res.body);
    expect(attempt.itemId).toBe('i-att-c');
    expect(attempt.microKpId).toBe('kp-att-child');
    expect(attempt.levelId).toBe('lv-att');
    expect(attempt.correct).toBe(false); // 正确答案是 0
    expect(attempt.knowledgeKind).toBe('concept');
    expect(attempt.countsTowardMastery).toBe(true);
    expect(attempt.attemptNo).toBe(1);

    const rows = await db.query<{ latency_ms: number; hints_used: number; attempt_no: number }>(
      `SELECT latency_ms, hints_used, attempt_no FROM attempts WHERE item_id = 'i-att-c'`,
    );
    expect(rows[0]).toMatchObject({ latency_ms: 12_345, hints_used: 1, attempt_no: 1 });
  });

  it('第几次作答按「同一道题」递增，不是按全局', async () => {
    const second = await submit({ itemId: 'i-att-a', answer: 0 }).expect(200);
    expect(second.body.attempt.attemptNo).toBe(2);
    const other = await submit({ itemId: 'i-att-d', answer: 0 }).expect(200);
    expect(other.body.attempt.attemptNo).toBe(1);
  });

  it('深究段的作答落库但不计入掌握度（全程不扣掌握度）', async () => {
    const before = await request(app.getHttpServer()).get('/api/v1/mastery/kp-att-child').expect(200);

    const res = await submit({ itemId: 'i-att-deepen', answer: 1, stepId: 's-deepen' }).expect(200);
    expect(res.body.attempt.countsTowardMastery).toBe(false);

    const after = await request(app.getHttpServer()).get('/api/v1/mastery/kp-att-child').expect(200);
    // 答错也不影响两个百分比，作答次数与变式数同样不动
    expect(after.body.attemptCount).toBe(before.body.attemptCount);
    expect(after.body.variantCount).toBe(before.body.variantCount);
    expect(after.body.current).toBe(before.body.current);
    expect(after.body.achieved).toBe(before.body.achieved);

    // 但证据本身还在库里，可以回看
    const rows = await db.query(`SELECT 1 FROM attempts WHERE item_id = 'i-att-deepen'`);
    expect(rows).toHaveLength(1);
  });

  it('证据不足时两个百分比都是 null，不是 0', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/mastery/kp-att-child').expect(200);
    assertMatchesContract('/api/v1/mastery/{microKpId}', 'get', 200, res.body);
    // 此时只做了 2 个变式、3 次作答，远低于 3 变式 / 8 次
    expect(res.body.evidenceSufficient).toBe(false);
    expect(res.body.achieved).toBeNull();
    expect(res.body.current).toBeNull();
    expect(res.body.attemptCount).toBeGreaterThan(0);
  });

  it('累计到 3 个变式与 8 次作答后开始给数字，且 achieved 不低于 current', async () => {
    for (const itemId of ['i-att-a', 'i-att-b', 'i-att-c', 'i-att-d']) {
      for (let round = 0; round < 2; round += 1) {
        const res = await submit({ itemId, answer: 0 }).expect(200);
        if (res.body.mastery.evidenceSufficient) {
          expect(res.body.mastery.achieved).not.toBeNull();
          expect(res.body.mastery.current).not.toBeNull();
          expect(res.body.mastery.achieved).toBeGreaterThanOrEqual(res.body.mastery.current);
        }
      }
    }

    const res = await request(app.getHttpServer()).get('/api/v1/mastery/kp-att-child').expect(200);
    expect(res.body.evidenceSufficient).toBe(true);
    expect(res.body.achieved).toBeGreaterThan(0);
    expect(res.body.current).toBeGreaterThan(0);
    expect(res.body.current).toBeLessThanOrEqual(res.body.achieved);
    expect(res.body.state).toBe('mastered');
  });

  it('达标签到之后：答错会降 current，而 achieved 保持不降', async () => {
    const before = await request(app.getHttpServer()).get('/api/v1/mastery/kp-att-child').expect(200);
    const res = await submit({ itemId: 'i-att-c', answer: 1 }).expect(200);

    expect(res.body.mastery.current).toBeLessThan(before.body.current);
    expect(res.body.mastery.achieved).toBe(before.body.achieved);
  });

  it('非叶节点的掌握度是只读派生：不落库、且由子节点的证据量加权', async () => {
    const parent = await request(app.getHttpServer()).get('/api/v1/mastery/kp-att').expect(200);
    expect(parent.body.isLeaf).toBe(false);
    expect(parent.body.aggregatedLeafCount).toBe(1);
    // 聚合值来自子节点，父节点没有自己的 attempts
    expect(parent.body.attemptCount).toBeGreaterThan(0);

    const rows = await db.query(`SELECT 1 FROM mastery WHERE micro_kp_id = 'kp-att'`);
    expect(rows).toHaveLength(0);
  });

  it('叶节点掌握度行确实落库（票 05 要求同事务更新）', async () => {
    const rows = await db.query<{
      achieved: string;
      current: string;
      state: string;
      attempt_count: number;
      variant_count: number;
      evidence_sufficient: boolean;
    }>(
      `SELECT achieved, current, state, attempt_count, variant_count, evidence_sufficient
         FROM mastery WHERE micro_kp_id = 'kp-att-child'`,
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.achieved)).toBeGreaterThan(0);
    expect(Number(rows[0]?.current)).toBeGreaterThan(0);
    expect(rows[0]?.state).toBe('mastered');
    expect(rows[0]?.variant_count).toBe(3);
    expect(rows[0]?.evidence_sufficient).toBe(true);
  });

  it('同一串作答输入，重放两次得出完全相同的数（无随机、无时钟泄漏）', async () => {
    const a = await request(app.getHttpServer()).get('/api/v1/mastery/kp-att-child').expect(200);
    const b = await request(app.getHttpServer()).get('/api/v1/mastery/kp-att-child').expect(200);
    expect(a.body.current).toBe(b.body.current);
    expect(a.body.achieved).toBe(b.body.achieved);
    expect(a.body.state).toBe(b.body.state);
  });

  it('题目不存在返回 404', async () => {
    const res = await submit({ itemId: 'i-不存在', answer: 0 }).expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toContain('题目不存在');
    assertMatchesContract('/api/v1/attempts', 'post', 404, res.body);
  });

  it('选项下标越界返回 422，不是静默判错', async () => {
    const res = await submit({ itemId: 'i-att-a', answer: 9 }).expect(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.message).toContain('选项');
  });

  it('谎报一个不引用该题的步骤返回 422（不能靠改 stepId 给深究段刷分）', async () => {
    const res = await submit({ itemId: 'i-att-a', answer: 0, stepId: 's-deepen' }).expect(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.message).toContain('步骤');
  });

  it('知识点不存在返回 404', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/mastery/kp-不存在').expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toContain('知识点不存在');
  });
});
