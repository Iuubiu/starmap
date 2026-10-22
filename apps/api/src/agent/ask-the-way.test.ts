import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AgentTurnResponseSchema } from '@starmap/api-contract';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../db/database.service.js';
import { ScriptedLlm } from '../llm/scripted-llm.js';
import { LLM_PORT } from '../llm/llm.port.js';
import { createTestSchema, type TestSchema } from '../../test/test-schema.js';
import { assertMatchesContract } from '../../test/contract.js';
import {
  ASK_THE_WAY_OPTIONS,
  ASK_THE_WAY_QUESTION,
  classifyIntentGoal,
  classifyPracticePreference,
  hasAskedTheWay,
  readIntent,
  classifySelfLevel,
  selfLevelToTier,
  resolveIntentStep,
  saysSkipClarify,
} from './turn.service.js';

/**
 * 票 79「问津」的验收：出关卡之前先确认意图。
 *
 * ## 为什么判定要单独测
 *
 * 「什么时候该先问一句」是这个功能里唯一真正会出错的判断：
 *
 * - 问早了，学生只是说「我想学布尔代数」就被盘问，像注册；
 * - 问晚了，等于没做 —— 又变成「听你说个名词就出关」，方向可能是错的。
 *
 * 这条边界由 `resolveIntentStep` 决定，它是纯函数、不碰数据库也不碰模型，
 * 所以这里可以表驱动地把六种情况钉死。HTTP 层的用例只证明「服务真的用了
 * 这个判定，并且真的把意图写回了会话」。
 *
 * ## 三个真实请求剧本（票面验收原文）
 *
 * | 学生说的 | 期望 |
 * | --- | --- |
 * | 「我想学布尔代数」 | `clarify` 出现，**不出** `level_card`，且**没有调用模型** |
 * | （接上句）「为了考试」 | `clarify` 消失，出 `level_card` |
 * | 「我想学布尔代数，明天要考数电」 | 直接出 `level_card`，`meta.intent.goal === 'exam'` |
 * | 「别问了直接开始」 | 直接出 `level_card`，`meta.intent.goal === 'unspecified'` |
 *
 * 第一条里「没有调用模型」是刻意断言的：既然还没问清意图，任何出题都是在赌，
 * 而且白花一次上游调用。这一条只有在假模型上才测得出（真模型上看不出「省了
 * 一次调用」和「调用了但没用结果」的区别）。
 */

let app: INestApplication;
let schema: TestSchema;
let db: DatabaseService;

/** 出关卡的剧本：足够出一张 level_card，且措辞合规（全中文、不带内部字段）。 */
const LEVEL_PLAN = JSON.stringify({
  visibleResponse: '按考试深度来，这一关先把吸收律和德摩根律练熟。',
  cardKind: 'level_card',
  rationale: '你说了明天要考数电，先练最常考的两条律。',
});

const scripted = new ScriptedLlm([
  { whenUserSays: '为了考试', text: LEVEL_PLAN },
  { text: LEVEL_PLAN },
]);

const turn = (sessionId: string, utterance: string, microKpId: string | null = null) =>
  request(app.getHttpServer())
    .post('/api/v1/agent/turns')
    .send({ sessionId, utterance, microKpId, tier: 'P1' })
    .then((response) => response);

const metaOf = async (sessionId: string): Promise<Record<string, unknown>> => {
  const rows = await db.query<{ meta: Record<string, unknown> | null }>(
    'SELECT meta FROM sessions WHERE id = $1',
    [sessionId],
  );
  return rows[0]?.meta ?? {};
};

beforeAll(async () => {
  schema = await createTestSchema();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LLM_PORT)
    .useValue(scripted)
    .compile();
  app = moduleRef.createNestApplication();
  db = app.get(DatabaseService);
  await db.useSchema(schema.name);
  await app.init();

  const q = (sql: string, params: readonly unknown[] = []) => db.query(sql, params);

  // 只种一个知识点：焦点匹配与「没有焦点时按推荐挑」这两条路都要有落点。
  await q(`INSERT INTO ${schema.name}.subjects (id, name) VALUES ('nuclear', '核电子学')`);
  await q(
    `INSERT INTO ${schema.name}.modules (id, subject_id, name, tier, ordinal)
     VALUES ('m-bool', 'nuclear', '数字逻辑基础', 'A', 1)`,
  );
  await q(
    `INSERT INTO ${schema.name}.knowledge_points (id, module_id, name, is_leaf, depth, ordinal)
     VALUES ('kp-bool', 'm-bool', '布尔代数基本运算', true, 1, 1)`,
  );
  await q(
    `INSERT INTO ${schema.name}.sources (id, title, kind) VALUES ('src-bool', '数字电子技术基础', 'book')`,
  );
  // 推荐只挑「有内容」的叶节点，没有这条切片时 case ③ 会连焦点都挑不出来。
  await q(
    `INSERT INTO ${schema.name}.chunks (id, source_id, micro_kp_id, ordinal, kind, text, page)
     VALUES ('ck-bool', 'src-bool', 'kp-bool', 1, 'text',
             '布尔代数的基本运算与或非，以及吸收律、德摩根律的化简用法。', 12)`,
  );
  await q(
    `INSERT INTO ${schema.name}.levels (id, micro_kp_id, title, kind, ordinal, spec)
     VALUES ('lv-bool-laws', 'kp-bool', '逻辑代数基本律：吸收律与德摩根律', 'teach', 1, $1::jsonb)`,
    [JSON.stringify({ meta: { estimatedMinutes: 14 }, steps: [{ kind: 'guide' }] })],
  );
  await q(
    `INSERT INTO ${schema.name}.level_items
       (id, level_id, stem, answer, explain_correct, explain_wrong, variant_group, pool)
     VALUES ('it-b1', 'lv-bool-laws', '吸收律 A+AB 等于什么？', '{"value":"A"}', '见书', '见书', 'vg-b1', 'quiz'),
            ('it-b2', 'lv-bool-laws', '德摩根律对积取反等于什么？', '{"value":"反或"}', '见书', '见书', 'vg-b2', 'quiz'),
            ('it-b3', 'lv-bool-laws', 'A·A 化简结果？', '{"value":"A"}', '见书', '见书', 'vg-b3', 'quiz'),
            ('it-b4', 'lv-bool-laws', 'A+A 化简结果？', '{"value":"A"}', '见书', '见书', 'vg-b4', 'quiz'),
            ('it-b5', 'lv-bool-laws', '对偶规则怎么用？', '{"value":"对偶"}', '见书', '见书', 'vg-b5', 'quiz')`,
  );
});

afterAll(async () => {
  await app.close();
  await schema.drop();
});

describe('判定规则（纯函数）', () => {
  it('目标词把话归到四种意图之一；只说名词就是 null', () => {
    expect(classifyIntentGoal('我想学布尔代数，明天要考数电')).toBe('exam');
    expect(classifyIntentGoal('这道题不会，帮我解题')).toBe('solve_problem');
    expect(classifyIntentGoal('想看懂这篇论文里的噪声推导')).toBe('read_paper');
    expect(classifyIntentGoal('基础太差，想补基础')).toBe('foundation');
    // 只说了一个宽泛名词：这是「话题」，不是「需求」。
    expect(classifyIntentGoal('我想学布尔代数')).toBeNull();
    expect(classifyIntentGoal('教我卡诺图')).toBeNull();
  });

  it('「别问了」被识别为跳过，包括直接开始/少废话', () => {
    expect(saysSkipClarify('别问了，直接开始')).toBe(true);
    expect(saysSkipClarify('不用问，直接出关卡')).toBe(true);
    expect(saysSkipClarify('少废话')).toBe(true);
    expect(saysSkipClarify('我想学布尔代数')).toBe(false);
  });

  it('先讲还是先练：说了才有值，没说就是 null（不是 false）', () => {
    expect(classifyPracticePreference('先做题吧')).toBe(true);
    expect(classifyPracticePreference('先看讲解')).toBe(false);
    expect(classifyPracticePreference('我想学布尔代数')).toBeNull();
  });

  it('已定意图不再问，也不再被后面的技术细节改写', () => {
    const step = resolveIntentStep({
      utterance: '这个电路怎么算',
      microKpId: 'kp-bool',
      intent: { goal: 'exam', preferPractice: null, resolvedAt: '2026-10-22T00:00:00.000Z' },
      askedBefore: false,
    });
    expect(step).toEqual({ kind: 'none' });
  });

  it('宽泛名词 + 有焦点 → 问一句；没有焦点 → 不问', () => {
    expect(
      resolveIntentStep({
        utterance: '我想学布尔代数',
        microKpId: 'kp-bool',
        intent: null,
        askedBefore: false,
      }),
    ).toEqual({ kind: 'ask' });

    // 连「为谁问」都不知道时问了像空转，所以这一轮不问。
    expect(
      resolveIntentStep({
        utterance: '我想学布尔代数',
        microKpId: null,
        intent: null,
        askedBefore: false,
      }),
    ).toEqual({ kind: 'none' });
  });

  it('只提到名词、不是学习请求 → 不问（别打断正在做题的人）', () => {
    for (const utterance of ['布尔代数', '这个电路怎么算', '前置放大器的噪声来源']) {
      expect(
        resolveIntentStep({ utterance, microKpId: 'kp-bool', intent: null, askedBefore: false }),
      ).toEqual({ kind: 'none' });
    }
  });

  it('跳过与「问过一次」都在模型之前落定，且目标词优先于 unspecified', () => {
    expect(
      resolveIntentStep({
        utterance: '别问了直接开始',
        microKpId: 'kp-bool',
        intent: null,
        askedBefore: false,
      }),
    ).toEqual({ kind: 'resolve', goal: 'unspecified', preferPractice: null, via: 'skip' });

    // 「别问了，但我是为了考试」——尊重学生的同时，把他说过的目标记下来。
    expect(
      resolveIntentStep({
        utterance: '别问了，我是为了考试',
        microKpId: 'kp-bool',
        intent: null,
        askedBefore: false,
      }),
    ).toMatchObject({ kind: 'resolve', goal: 'exam', via: 'skip' });

    // 第二问的回答：这一句是答案，不是新话题。
    expect(
      resolveIntentStep({
        utterance: '为了看懂论文',
        microKpId: 'kp-bool',
        intent: null,
        askedBefore: true,
      }),
    ).toMatchObject({ kind: 'resolve', goal: 'read_paper', via: 'clarify_answer' });
  });

  it('会话 meta 的读取对脏数据免疫', () => {
    expect(readIntent({})).toBeNull();
    expect(readIntent({ intent: { goal: '瞎写' } })).toBeNull();
    /* 票 84：`selfLevel` 是新增字段，旧会话没有它 —— 必须读成 null 而不是
       「形状不对整条丢掉」，否则老会话的意图会突然消失。 */
    expect(readIntent({ intent: { goal: 'exam', preferPractice: true, resolvedAt: 'x' } })).toEqual({
      goal: 'exam',
      preferPractice: true,
      selfLevel: null,
      resolvedAt: 'x',
    });
    expect(
      readIntent({ intent: { goal: 'exam', preferPractice: null, selfLevel: '瞎写', resolvedAt: 'x' } }),
    ).toEqual({ goal: 'exam', preferPractice: null, selfLevel: null, resolvedAt: 'x' });
    expect(
      readIntent({ intent: { goal: 'exam', preferPractice: null, selfLevel: 'slow', resolvedAt: 'x' } }),
    ).toEqual({ goal: 'exam', preferPractice: null, selfLevel: 'slow', resolvedAt: 'x' });
    expect(hasAskedTheWay({})).toBe(false);
    expect(hasAskedTheWay({ askTheWay: { askedAt: 'x' } })).toBe(true);
    expect(hasAskedTheWay({ askTheWay: { askedAt: 3 } })).toBe(false);
  });

  it('自评四档的解析与「说不清就 null」', () => {
    expect(classifySelfLevel('我完全没学过')).toBe('none');
    expect(classifySelfLevel('见过但不会用')).toBe('seen');
    expect(classifySelfLevel('会做但慢')).toBe('slow');
    expect(classifySelfLevel('这条我很熟')).toBe('fluent');
    expect(classifySelfLevel('我想学布尔代数')).toBeNull();
    expect(selfLevelToTier('none')).toBe('P1');
    expect(selfLevelToTier('seen')).toBe('P1');
    expect(selfLevelToTier('slow')).toBe('P2');
    expect(selfLevelToTier('fluent')).toBe('P3');
    expect(selfLevelToTier(null)).toBeNull();
  });
});

describe('契约互斥：clarify 与 level_card 不能同时出现', () => {
  const response = (extra: Record<string, unknown>) => ({
    turnId: 'at-1',
    sessionId: 's-1',
    artifact: {
      kind: 'level_card',
      cardId: 'at-1',
      createdAt: '2026-10-22T00:00:00.000Z',
      levelId: 'lv-bool-laws',
      microKpId: 'kp-bool',
      tier: 'P1',
      estimatedMinutes: 14,
      itemCount: 5,
      firstStepKind: 'guide',
      title: '逻辑代数基本律',
      rationale: '考试要考',
    },
    errorCard: null,
    degraded: false,
    retryCount: 0,
    visibleResponse: '这一关先练两条律。',
    visibleResponseKind: 'statement',
    languageCheck: { ok: true, offenders: [] },
    actions: [],
    createdAt: '2026-10-22T00:00:00.000Z',
    ...extra,
  });

  const clarify = {
    question: ASK_THE_WAY_QUESTION,
    options: [...ASK_THE_WAY_OPTIONS],
    why: '先问一句，免得按错的深度出题。',
  };

  it('同时给 clarify 与 level_card 会被 schema 拒掉', () => {
    const parsed = AgentTurnResponseSchema.safeParse(response({ clarify }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message)).toContain(
        '问津与出关卡不能同时出现：还没问清意图，就不该出关卡',
      );
    }
  });

  it('clarify 只能伴随 probe_form；不带的响应不受影响', () => {
    const probe = response({
      artifact: {
        kind: 'probe_form',
        cardId: 'at-1',
        createdAt: '2026-10-22T00:00:00.000Z',
        probeId: 'clarify-at-1',
        microKpId: 'kp-bool',
        question: ASK_THE_WAY_QUESTION,
        ladderLevel: 1,
        ladderCap: 1,
        inputKind: 'choice',
        choices: [...ASK_THE_WAY_OPTIONS],
        actions: [],
        rationale: '先问一句。',
        title: '问津：布尔代数',
      },
      clarify,
    });
    expect(AgentTurnResponseSchema.safeParse(probe).success).toBe(true);
    expect(AgentTurnResponseSchema.safeParse(response({})).success).toBe(true);
  });
});

describe('HTTP：三个真实请求剧本', () => {
  it('只说「我想学布尔代数」→ 返回 clarify，不出关卡，且没有调用模型', async () => {
    const before = scripted.calls.length;
    const response = await turn('ses-ask-way-1', '我想学布尔代数');

    expect(response.status).toBe(200);
    assertMatchesContract('/api/v1/agent/turns', 'post', 200, response.body);
    const body = AgentTurnResponseSchema.parse(response.body);

    expect(body.clarify?.question).toBe(ASK_THE_WAY_QUESTION);
    expect(body.clarify?.options).toEqual([...ASK_THE_WAY_OPTIONS]);
    expect(body.artifact?.kind).toBe('probe_form');
    expect(body.artifact?.kind).not.toBe('level_card');
    expect(body.visibleResponseKind).toBe('probe_question');
    // 关键：意图没问清之前，一次模型调用都不该发生。
    expect(scripted.calls.length).toBe(before);

    const meta = await metaOf('ses-ask-way-1');
    expect(hasAskedTheWay(meta)).toBe(true);
    expect(readIntent(meta)).toBeNull(); // 问过了，但还没答案
  });

  it('回答「为了考试」后出关卡，意图写回会话', async () => {
    const response = await turn('ses-ask-way-1', '为了考试');
    expect(response.status).toBe(200);
    assertMatchesContract('/api/v1/agent/turns', 'post', 200, response.body);
    const body = AgentTurnResponseSchema.parse(response.body);

    expect(body.clarify).toBeUndefined();
    expect(body.artifact?.kind).toBe('level_card');

    const meta = await metaOf('ses-ask-way-1');
    expect(readIntent(meta)).toMatchObject({ goal: 'exam' });
  });

  it('说清目的时直接出关卡并记下意图', async () => {
    const response = await turn('ses-ask-way-2', '我想学布尔代数，明天要考数电');
    expect(response.status).toBe(200);
    assertMatchesContract('/api/v1/agent/turns', 'post', 200, response.body);
    const body = AgentTurnResponseSchema.parse(response.body);
    expect(body.clarify).toBeUndefined();
    expect(body.artifact?.kind).toBe('level_card');
    expect(readIntent(await metaOf('ses-ask-way-2'))).toMatchObject({ goal: 'exam' });
  });

  it('说「别问了直接开始」时尊重学生：直接出关卡，意图记 unspecified', async () => {
    const response = await turn('ses-ask-way-3', '别问了直接开始');
    expect(response.status).toBe(200);
    assertMatchesContract('/api/v1/agent/turns', 'post', 200, response.body);
    const body = AgentTurnResponseSchema.parse(response.body);
    expect(body.clarify).toBeUndefined();
    expect(body.artifact?.kind).toBe('level_card');
    expect(readIntent(await metaOf('ses-ask-way-3'))).toMatchObject({
      goal: 'unspecified',
      preferPractice: null,
    });
  });
});
