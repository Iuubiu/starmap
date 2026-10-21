import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../db/database.service.js';
import { LLM_PORT } from '../llm/llm.port.js';
import { ScriptedLlm } from '../llm/scripted-llm.js';
import { assertMatchesContract } from '../../test/contract.js';
import { createTestSchema, type TestSchema } from '../../test/test-schema.js';

/**
 * 苏格拉底追问状态机（票 10）的接口级测试。
 *
 * ## 测的是「策略核心有没有被模型绕过」
 *
 * 票 10 最容易被做假的地方，是把「本轮最多到第几级」写进提示词让模型自己
 * 遵守。那种实现下，测试只要换一个听话的假模型就能通过，而真实模型越强越
 * 容易漏答案（arXiv:2608.12292）。所以这里刻意让 `ScriptedLlm` 变得**不听话**：
 * 它返回的「问题」里带答案、带公式、带两个问号。如果上限真的由非 LLM 的
 * `nextLadder` 决定，越界的措辞会被 judge 拦下并退回骨架问句，最终落库的
 * 问题不含答案、只有一个问号、且阶梯等级仍在 `cap` 以内。
 *
 * ## 为什么计数器从接口推
 *
 * 用户看到的只有「第几轮、什么动作、问了什么」，计数器是内部状态。断言动作
 * 序列（hint → reteach）而不是断言 `consecutiveUnknown === 2`，测的才是行为。
 * 内部计数器的语义另有 `packages/engine/src/probe-ladder.test.ts` 覆盖。
 */

let app: INestApplication;
let schema: TestSchema;

/**
 * 不听话的假模型。
 *
 * - 判分：一律「答错」（要走到 reteach 才能验证退出路径）
 * - 措辞：**故意越界** —— 第 1 级提示里塞最终数值与公式，还问两个问题
 *
 * 真实实现里 `phraseQuestion` 拿到这句话会先过 judge，越界则退回 `safeQuestion`。
 * 这里就是要在接口层看到这个兜底真的生效。
 */
const LEAKY_QUESTION = '答案是 120，用公式 ENC = sqrt(4kT/RF) 算。单位是什么？误差有多大？';
// 必须是**合法 JSON**：措辞调用带 schema，服务端只认 `parsed.question`。
// 塞纯文本的话 `parsed` 为 null，服务端直接退回骨架问句 —— 越界根本没发生，
// 测试就会变成「验证兜底没被触发」，看起来绿但什么都没测到。
const LEAKY_REPLY = JSON.stringify({ question: LEAKY_QUESTION });

const scripted = new ScriptedLlm([
  // 「部分正确」的专用锚点：`gradeReply` 的用户消息里带着学生原话
  // （`学生的回答：...`），所以拿学生这句答复当锚点最稳。必须排在下面那条
  // 通用锚点**之前**——`ScriptedLlm` 取的是数组里第一个命中的项，而两句
  // 提示词都能命中通用项。五级阶梯要逐级往上走，需要 partial 这一档：
  // 它不升阶梯但把 level 抬到本档起点，是「爬到第 5 级」的起手式。
  {
    whenUserSays: '方向大概对了一半',
    text: '{"verdict":"partial","reason":"脚本设定为部分正确"}',
  },
  // 锚点取自服务端真实提示词的**用户消息**（`ScriptedLlm` 只匹配最后一条
  // user 消息）。用自以为好记的词当锚点会让两次调用都落到兜底项，
  // 于是「模型越界」根本没发生，测试反而变成验证兜底没被触发。
  { whenUserSays: '学生的回答', text: '{"verdict":"wrong","reason":"脚本设定为答错"}' },
  { whenUserSays: '本轮可用到的最高阶梯', text: LEAKY_REPLY },
  { text: '{"verdict":"wrong","reason":"脚本设定为答错"}' },
]);

beforeAll(async () => {
  schema = await createTestSchema();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LLM_PORT)
    .useValue(scripted)
    .compile();

  app = moduleRef.createNestApplication();
  const db = app.get(DatabaseService);
  await db.useSchema(schema.name);
  await app.init();

  const q = (sql: string, params: readonly unknown[] = []) => db.query(sql, params);

  await q(`INSERT INTO ${schema.name}.subjects (id, name) VALUES ('nuclear', '核电子学')`);
  await q(
    `INSERT INTO ${schema.name}.modules (id, subject_id, name, tier, ordinal)
     VALUES ('m-a', 'nuclear', '信号与噪声', 'A', 1)`,
  );
  await q(
    `INSERT INTO ${schema.name}.knowledge_points (id, module_id, name, is_leaf, depth, ordinal)
     VALUES ('kp-a', 'm-a', '电荷灵敏前置放大器', true, 1, 1)`,
  );
  await q(
    // spec 必须显式给：0004 撤掉了这一列的 DEFAULT，正是为了逼出「忘了写 spec」。
    `INSERT INTO ${schema.name}.levels (id, micro_kp_id, title, kind, ordinal, spec)
     VALUES ('lv-a', 'kp-a', '前置放大器的噪声', 'teach', 1,
             '{"schemaVersion": 1, "meta": {"id": "lv-a", "microKpId": "kp-a", "title": "前置放大器的噪声", "tier": "P1", "estimatedMinutes": 15, "author": "system", "isEntry": true}, "sources": [], "cards": [], "steps": [], "items": [], "gating": {"mode": "allItems", "itemCount": 1, "passCount": 1}}'::jsonb)`,
  );
  // `expectedAnswer` 从这里读 value / formula —— 它**永远不进提示词**，
  // 只用于 judge 判定「这句话有没有把答案说出来」。
  await q(
    `INSERT INTO ${schema.name}.level_items
       (id, level_id, stem, answer, explain_correct, explain_wrong, variant_group, pool)
     VALUES ('it-a', 'lv-a', '等效噪声电荷的量级是多少？',
             '{"value": 120, "formula": "ENC = sqrt(4kT/RF)"}',
             '见书', '见书', 'vg-a', 'quiz')`,
  );

  // 一条**故意坏掉的关卡**：spec 是空对象，`validateLevelSpec` 会判它缺
  // `meta.id`、`schemaVersion`、`gating.mode` 等必填字段。追问链路不该读 spec
  // （它读的是 `level_items.answer`，那是判分用的标准答案），所以这个知识点
  // 上的追问必须**正常工作**而不是 500。
  //
  // 这条断言的意义不是「恰好没读到 spec」，而是「明确不依赖 spec 的合法性」：
  // 关卡规范是 level 泳道的产物，它可以先于 spec 定稿而入库；追问状态机要是
  // 因为旁边放了一张坏关卡就崩，学生会在最需要帮助的时刻看到 500。
  await q(
    `INSERT INTO ${schema.name}.knowledge_points (id, module_id, name, is_leaf, depth, ordinal)
     VALUES ('kp-broken', 'm-a', '卡诺图化简', true, 1, 2)`,
  );
  await q(
    `INSERT INTO ${schema.name}.levels (id, micro_kp_id, title, kind, ordinal, spec)
     VALUES ('lv-broken', 'kp-broken', '坏掉的一关', 'teach', 1, '{}'::jsonb)`,
  );
}, 60_000);

afterAll(async () => {
  await app?.close();
  await schema?.drop();
});

interface Ladder {
  level: number;
  cap: number;
  maxLevelUsed: number;
  consecutiveUnknown: number;
  consecutiveWrong: number;
  noProgress: number;
  exited: boolean;
}

interface TurnBody {
  probeId: string;
  action: string;
  actionReason: string | null;
  question: string | null;
  replyKind: string;
  ladder: Ladder;
  judge: { passed: boolean; reasons: string[]; questionCount: number };
  /** 越界措辞被换成骨架问句时为 true。它记录的是「兜底发生过」，不是「越界了」。 */
  fallbackApplied: boolean;
}

async function startProbe(tier: 'P1' | 'P2' | 'P3' = 'P1'): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/agent/probes')
    .send({ microKpId: 'kp-a', tier })
    .expect(200);
  // 200 而不是 201：建会话返回的是「起始档位」这份状态快照，不是新资源句柄。
  assertMatchesContract('/api/v1/agent/probes', 'post', 200, res.body);
  return (res.body as { probeId: string }).probeId;
}

async function reply(probeId: string, replyText: string): Promise<TurnBody> {
  const res = await request(app.getHttpServer())
    .post(`/api/v1/agent/probes/${probeId}/replies`)
    .send({ replyText })
    .expect(200);
  assertMatchesContract(`/api/v1/agent/probes/{probeId}/replies`, 'post', 200, res.body);
  return res.body as TurnBody;
}

describe('阶梯上限由策略核心决定，模型无权越过', () => {
  it('模型给出越界措辞时，落库的问题是骨架问句而不是模型原话', async () => {
    const probeId = await startProbe('P1');
    const turn = await reply(probeId, '不知道');

    // judge 必须判它越界。若这里 passed === true，说明越界检测没生效。
    expect(turn.judge.passed).toBe(false);
    // **按原因分类**是票 10 的原话。这里三类的来源各不相同，一起断言顺带
    // 证明了「标准答案确实被读到了」：`leaks_final_value` 与 `leaks_formula`
    // 只有在 `expectedAnswer` 取到 value=120 / formula=ENC = sqrt(4kT/RF) 时才
    // 可能触发 —— 若标准答案没读出来，这两条断言会立刻红，而不是让下面对
    // `question` 的负向断言悄悄空过。
    expect(turn.judge.reasons).toContain('leaks_final_value');
    expect(turn.judge.reasons).toContain('leaks_formula');
    expect(turn.judge.reasons).toContain('multiple_questions');

    // `judge.questionCount` 数的是**模型原话**的问号数（2 个），它记录的是
    // 「模型越界到什么程度」，不是「最终给学生的问句」。所以这里不能拿它
    // 断言最终问句的形式 —— 那要直接数 `question`。
    expect(turn.judge.questionCount).toBe(2);
    expect(turn.fallbackApplied).toBe(true);

    const question = turn.question ?? '';
    // 替身回来的原话里有最终数值 120 与公式 ENC = sqrt(4kT/RF)，一个都不能留下
    expect(question).not.toContain('120');
    expect(question).not.toContain('sqrt');
    // 兜底后的骨架问句本身合规：恰好一个问号，且在结尾
    expect(question.match(/[?？]/g) ?? []).toHaveLength(1);
    expect(question.trim().endsWith('？')).toBe(true);
  });

  it('P1 的 level 永远不会超过 3，即使模型一直给到第 5 级的措辞', async () => {
    const probeId = await startProbe('P1');
    const seen: number[] = [];
    let last: TurnBody | null = null;
    let fallbacks = 0;

    for (let i = 0; i < 4; i += 1) {
      last = await reply(probeId, '不知道');
      seen.push(last.ladder.level);
      if (last.fallbackApplied) fallbacks += 1;
      expect(last.ladder.level).toBeLessThanOrEqual(3);
      if (last.ladder.exited) break;
    }

    expect(last).not.toBeNull();
    // 正向对照：这一轮序列里模型**确实**越界过（否则「level 没超过 3」
    // 可能只是因为模型压根没推，测试就退化成了空断言）。
    expect(fallbacks).toBeGreaterThan(0);
    expect(seen.length).toBeGreaterThan(0);
    expect(Math.max(...seen)).toBeLessThanOrEqual(3);
  });

  it('P3 起步就在第 3 级，上限 5', async () => {
    const probeId = await startProbe('P3');
    const turn = await reply(probeId, '不知道');
    expect(turn.ladder.cap).toBe(5);
    expect(turn.ladder.level).toBeGreaterThanOrEqual(3);
  });
});

describe('五级求助阶梯逐级递进', () => {
  it('P3 能把五级阶梯走到第 5 级（设计权衡），且每轮只推进一格', async () => {
    const probeId = await startProbe('P3');

    // 起手必须用 partial：它不升阶梯但把 level 抬到本档起点（P3 = 第 3 级）。
    // 直接用 dont_know 会从 0 级 clamp 到 3 级，看不出「逐级」。
    const first = await reply(probeId, '方向大概对了一半');
    expect(first.replyKind).toBe('partial');
    expect(first.ladder.level).toBe(3);

    const second = await reply(probeId, '不知道');
    expect(second.action).toBe('hint');
    expect(second.ladder.level).toBe(4);

    const third = await reply(probeId, '我觉得是正比于温度');
    expect(third.action).toBe('hint');
    expect(third.ladder.level).toBe(5);
    expect(third.ladder.cap).toBe(5);
    expect(third.ladder.maxLevelUsed).toBe(5);
    expect(third.ladder.exited).toBe(false);

    // 第 5 级的主题必须是「设计权衡」。只看 level 数字不算数：
    // 数组错位一格时 level 仍然递增，但学生会连续两轮看到同一个问题。
    expect(third.question).toContain('设计权衡');
    expect(third.question).toContain('分辨率');
    expect(third.question).not.toBe(second.question);
    expect(third.question).not.toBe(first.question);
  });

  it('五级阶梯的主题两两不同，问题也不重复', async () => {
    // 这里验的是「阶梯本身有五个不同的档位」，与状态机无关，所以直接读常量。
    // 放接口测试里是为了让「第 5 级存在且内容有意义」这条与真实返回一起被看见。
    const { LADDER_LEVELS } = await import('@starmap/engine');
    expect(LADDER_LEVELS).toHaveLength(5);
    const topics = LADDER_LEVELS.map((entry) => entry.topic);
    expect(new Set(topics).size).toBe(5);
    const asks = LADDER_LEVELS.map((entry) => entry.ask);
    expect(new Set(asks).size).toBe(5);
    // 每个档位的问句都必须是**一个问题**（这一层由纯函数保证，
    // 因为 `safeQuestion` 在模型不配合时会原样把它拼给学习者）。
    for (const ask of asks) {
      expect((ask.match(/[?？]/g) ?? [])).toHaveLength(1);
      expect(ask.trim().endsWith('？')).toBe(true);
    }
  });

  it('P1 上三级提示逐级走完，第 4 次失败退出到 reteach 而不是再加一级', async () => {
    // 与上一条形成对照：不是「阶梯只有 3 级」，而是上限由档位决定。
    // 序列里必须交替「不知道」和「答错」：连说两次「不知道」会先撞上
    // `unknownBeforeReteach=2` 直接退出，还没爬到第 3 级就结束了。
    const probeId = await startProbe('P1');

    const first = await reply(probeId, '方向大概对了一半');
    expect(first.ladder.level).toBe(1);

    const second = await reply(probeId, '不知道');
    expect(second.action).toBe('hint');
    expect(second.ladder.level).toBe(2);

    const third = await reply(probeId, '我觉得是正比于温度');
    expect(third.action).toBe('hint');
    expect(third.ladder.level).toBe(3);

    // 三级提示都真的走到了（`1 → 2 → 3` 逐级，不跳级），且三句问题各不相同。
    // 只断言 `max(...) === 3` 是不够的：数组错位时最大值仍是 3，
    // 但学生会连续两轮看到同一句提示。
    const asked = [first.question, second.question, third.question];
    expect(new Set(asked).size).toBe(3);

    // 第 4 次失败：阶梯用尽，退出到 reteach（换更小粒度重讲），不是再加第 4 级。
    const fourth = await reply(probeId, '不知道');
    expect(fourth.ladder.exited).toBe(true);
    expect(fourth.action).toBe('reteach');
    expect(fourth.ladder.maxLevelUsed).toBe(3);
    expect(fourth.question).not.toBe(third.question);
  });
});

describe('两个计数器独立且阈值不同', () => {
  it('连续两次「不知道」就降级重讲（不知道的阈值是 2）', async () => {
    const probeId = await startProbe('P1');

    const first = await reply(probeId, '不知道');
    expect(first.ladder.exited).toBe(false);
    expect(first.action).toBe('hint');

    const second = await reply(probeId, '不知道');
    expect(second.replyKind).toBe('dont_know');
    expect(second.action).toBe('reteach');
    expect(second.actionReason).toBe('repeated_unknown');
    expect(second.ladder.exited).toBe(true);
  });

  it('连续三次「答错」才降级重讲（答错的阈值是 3）', async () => {
    const probeId = await startProbe('P1');

    const first = await reply(probeId, '我觉得是正比于温度');
    expect(first.replyKind).toBe('wrong');
    expect(first.ladder.exited).toBe(false);

    const second = await reply(probeId, '我觉得是正比于温度');
    expect(second.ladder.exited).toBe(false);

    const third = await reply(probeId, '我觉得是正比于温度');
    expect(third.action).toBe('reteach');
    expect(third.actionReason).toBe('repeated_wrong');
    expect(third.ladder.exited).toBe(true);
  });

  it('两个计数器互不覆盖：答错会打断「连续不知道」这条链', async () => {
    const probeId = await startProbe('P1');
    await reply(probeId, '不知道');
    const mixed = await reply(probeId, '我觉得是正比于温度');

    expect(mixed.replyKind).toBe('wrong');
    // 交替出现时两条链都到不了阈值，状态机不能因此退出
    expect(mixed.ladder.exited).toBe(false);
  });
});

describe('退出路径与「不无限追问」', () => {
  it('连续三轮无进展即退出追问，且是「换更小粒度重讲」而不是给答案', async () => {
    const probeId = await startProbe('P1');
    await reply(probeId, '不知道');
    await reply(probeId, '我觉得是正比于温度');
    const third = await reply(probeId, '不知道');

    expect(third.ladder.exited).toBe(true);
    // 票面写的是「改为换更小粒度重讲」。原来这里放宽成 `['reteach','reveal']`，
    // 等于允许「三轮答不上就直接揭晓」，正好是票面禁止的那条。收紧到 reteach，
    // 并且要求原因能说出是哪一类无进展（交替失败，不是某个计数器打满）。
    expect(third.action).toBe('reteach');
    expect(third.actionReason).toBe('no_progress');

    // 「不得直接给答案」：重讲的问题要么是问题，要么至少不能把标准答案念出来。
    const question = third.question ?? '';
    expect(question.length).toBeGreaterThan(0);
    expect(question).not.toContain('120');
    expect(question).not.toContain('sqrt');
    // 正向对照：它确实在问一件事（而不是空白字符串让上面两条负向断言白过）。
    expect((question.match(/[?？]/g) ?? [])).toHaveLength(1);
  });

  it('学生放弃时直接给结论，第一轮就退出（早于任何计数阈值）', async () => {
    // 票 10 的必测项之一。`packages/engine/src/probe.ts` 的老语义是
    // `PROBE_LIMITS.explicitGiveUp = 2`（连说两次「给我答案」才揭晓）；
    // `probe-ladder.ts` 收紧成第一次就揭晓 —— 学生都已经明说不想想了，
    // 再追一轮只是耽误时间，而且这一轮本身就可能是压垮他的那一轮。
    // 关键是「提前」：它必须早于 repeated_unknown(2) 与 no_progress(3)。
    const probeId = await startProbe('P2');
    const turn = await reply(probeId, '直接告诉我答案吧');

    expect(turn.replyKind).toBe('give_up');
    expect(turn.action).toBe('reveal');
    expect(turn.ladder.exited).toBe(true);
    // 第一轮就走到了退出，没等计数器打满
    expect(turn.ladder.consecutiveUnknown).toBe(0);
    expect(turn.ladder.consecutiveWrong).toBe(0);
    expect(turn.ladder.noProgress).toBe(0);

    // 退出之后不再开新的一轮：下一句无论说什么都只能是 exit。
    // （`question` 此时是策略核心的收尾话术「要不要换一个更小的知识点继续？」，
    //  它是元层面的邀约，不是对知识点的追问，所以这里断言的是 action 而不是问号。）
    const after = await reply(probeId, '那再问我一题');
    expect(after.action).toBe('exit');
    expect(after.ladder.exited).toBe(true);
  });

  it('情绪信号优先于任何计数阈值', async () => {
    const probeId = await startProbe('P3');
    const turn = await reply(probeId, '太难了，我不想做了');

    expect(turn.replyKind).toBe('frustration');
    expect(turn.action).toBe('reteach');
    expect(turn.actionReason).toBe('frustration');
    expect(turn.ladder.exited).toBe(true);
  });

  it('降级后换动作，不重复同一个问题', async () => {
    const probeId = await startProbe('P1');
    const first = await reply(probeId, '不知道');
    const second = await reply(probeId, '不知道');

    expect(second.action).not.toBe(first.action);
    expect(second.question).not.toBe(first.question);
  });
});

describe('每轮只问一个问题', () => {
  it('所有落库问题都恰好一个问号', async () => {
    const probeId = await startProbe('P1');
    const questions: string[] = [];

    for (let i = 0; i < 3; i += 1) {
      const turn = await reply(probeId, '不知道');
      if (turn.question) questions.push(turn.question);
      // 这里数的是**最终看到的问句**，不是 judge 记下的模型原话。
      expect((turn.question ?? '').match(/[?？]/g) ?? []).toHaveLength(1);
      if (turn.ladder.exited) break;
    }

    // 正向对照：真的收集到了问句（否则上面的循环断言在「一轮都没走到」时也绿）
    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      expect(question.match(/[?？]/g) ?? []).toHaveLength(1);
      expect(question.trim().endsWith('？')).toBe(true);
    }
    // 三句问题两两不同：重复提问本身就是缺陷（票 10 最后一条）。
    expect(new Set(questions).size).toBe(questions.length);
  });
});

describe('越界比例可测量', () => {
  it('metrics 报告判分轮数与越界轮数，并按拒绝原因分类', async () => {
    // **自己造轮次**，不依赖前面用例留下的状态：否则单独跑这一条
    // （`vitest -t`）会因为 `turns === 0` 直接红，而红的原因与它要
    // 证明的事情无关。
    //
    // 一条「不知道」就够了：它会走 `phraseQuestion`，拿到替身的越界措辞，
    // 被 judge 判为泄露数值 + 泄露公式 + 一轮多问。
    const probeId = await startProbe('P1');
    const turn = await reply(probeId, '不知道');
    expect(turn.fallbackApplied).toBe(true);

    const res = await request(app.getHttpServer())
      .get('/api/v1/agent/probes/metrics')
      .expect(200);
    assertMatchesContract('/api/v1/agent/probes/metrics', 'get', 200, res.body);

    const body = res.body as {
      turns: number;
      violations: number;
      violationRate: number;
      reasonCounts: Record<string, number>;
    };

    expect(body.turns).toBeGreaterThan(0);
    expect(body.violations).toBeGreaterThan(0);
    expect(body.violationRate).toBeGreaterThan(0);
    expect(body.violationRate).toBeLessThanOrEqual(1);
    expect(body.violationRate).toBeCloseTo(body.violations / body.turns, 5);

    // 分类必须能说出「因为什么」被判越界，而不只是一个总数。
    // 这里指名两类：它们是 `expectedAnswer` 真的读到 value=120 / formula 的
    // 证据 —— 标准答案没读出来时这两类根本不可能出现。
    expect(body.reasonCounts.leaks_final_value).toBeGreaterThan(0);
    expect(body.reasonCounts.leaks_formula).toBeGreaterThan(0);

    const counts = Object.values(body.reasonCounts);
    // 一轮可以同时命中多个拒绝原因（既有数值又有公式还有两个问号），
    // 所以 reasonCounts 之和是「拒绝原因出现次数」，>= 越界轮数而不是等于。
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(body.violations);
  });
});

describe('不得把正确答案塞进提示生成的 prompt', () => {
  it('措辞调用与判分调用的提示词里都没有标准答案', async () => {
    // 票 10 明文要求。这条最容易被「顺手」破坏：判分需要标准答案，
    // 而判分与措辞共用同一个 `LlmPort`，把 `expectedAnswer` 拼进措辞提示词
    // 只是复制一行的距离；更糟的是模型看到答案后会把它「自然地」问出来。
    //
    // 断言方式：拿这一段调用区间的**全部消息正文**去查标准答案的三个特征。
    // 区间而不是全量，是因为 `scripted.calls` 在整份文件里累积，别的用例
    // 可能自己就带了这些字面量。
    const before = scripted.calls.length;
    const probeId = await startProbe('P1');
    await reply(probeId, '不知道');
    await reply(probeId, '我觉得是正比于温度');
    const after = scripted.calls.slice(before);

    expect(after.length).toBeGreaterThan(0);

    for (const call of after) {
      const text = call.messages.map((m) => m.content).join('\n');
      // 标准答案的数值 120、公式 ENC = sqrt(4kT/RF)、以及原始 answer JSON。
      // `ENC` / `4kT` 单独查会误伤正常措辞（提到概念名不算泄题），所以查的是
      // 能拼出答案的那几段。
      expect(text).not.toContain('120');
      expect(text).not.toContain('sqrt(4kT/RF)');
      expect(text).not.toContain('"value"');
      expect(text).not.toContain('"formula"');
    }

    // 正向对照：这段区间里**确实**调过措辞模型（否则上面四条在「一次都没调」
    // 时也全绿）。措辞调用的用户消息以「本轮可用到的最高阶梯」开头。
    const phraseCalls = after.filter((call) =>
      call.messages.some((m) => m.content.includes('本轮可用到的最高阶梯')),
    );
    expect(phraseCalls.length).toBeGreaterThan(0);
  });
});

describe('会话读取与错误处理', () => {
  it('创建后能读回会话，turns 为 0', async () => {
    const probeId = await startProbe('P2');
    const res = await request(app.getHttpServer())
      .get(`/api/v1/agent/probes/${probeId}`)
      .expect(200);
    assertMatchesContract('/api/v1/agent/probes/{probeId}', 'get', 200, res.body);

    const body = res.body as { probeId: string; turns: number; ladder: Ladder; askedQuestions: string[] };
    expect(body.probeId).toBe(probeId);
    expect(body.turns).toBe(0);
    expect(body.askedQuestions).toEqual([]);
    expect(body.ladder.cap).toBe(4);
  });

  it('知识点不存在时 404', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/agent/probes')
      .send({ microKpId: 'kp-missing', tier: 'P1' })
      .expect(404);
    assertMatchesContract('/api/v1/agent/probes', 'post', 404, res.body);
    expect((res.body as { code: string }).code).toBe('NOT_FOUND');
  });

  it('会话不存在时 404', async () => {
    await request(app.getHttpServer()).get('/api/v1/agent/probes/pr-missing').expect(404);
  });

  it('空回复被拒（400），不会推进状态', async () => {
    const probeId = await startProbe('P1');
    const res = await request(app.getHttpServer())
      .post(`/api/v1/agent/probes/${probeId}/replies`)
      .send({ replyText: '' })
      .expect(400);
    assertMatchesContract('/api/v1/agent/probes/{probeId}/replies', 'post', 400, res.body);
    expect((res.body as { code: string }).code).toBe('VALIDATION_FAILED');
  });
});

describe('追问不依赖关卡规范的合法性', () => {
  it('知识点上挂着一关 spec 为空对象的坏关卡时，追问全流程正常', async () => {
    // 建会话：不能因为旁边那张坏关卡而 500。
    const created = await request(app.getHttpServer())
      .post('/api/v1/agent/probes')
      .send({ microKpId: 'kp-broken', tier: 'P1' })
      .expect(200);
    assertMatchesContract('/api/v1/agent/probes', 'post', 200, created.body);
    const probeId = (created.body as { probeId: string }).probeId;

    // 推进一轮：判分读 `level_items.answer`，坏的 spec 不影响。
    const turned = await reply(probeId, '不知道');
    expect(turned.ladder.exited).toBe(false);
    // 坏关卡没有 level_items，所以 `expectedAnswer` 拿不到期望值 ——
    // judge 仍然要对「模型原话」做出判定，只是判不了数值泄露。
    expect(typeof turned.judge.passed).toBe('boolean');
    expect((turned.question ?? '').match(/[?？]/g) ?? []).toHaveLength(1);

    // 读回会话：状态已落库，说明整条链路没有在中间某处静默失败。
    const read = await request(app.getHttpServer())
      .get(`/api/v1/agent/probes/${probeId}`)
      .expect(200);
    expect((read.body as { turns: number }).turns).toBe(1);
  });

  it('对照：同一张坏关卡在关卡接口上确实会被判为不合法', async () => {
    // 没有这条对照，「追问正常」就可能只是「两张关卡都被当成合法」，
    // 那这条测试证明不了「追问跳过了 spec 校验」，只证明了「校验没生效」。
    const res = await request(app.getHttpServer()).get('/api/v1/levels/lv-broken');
    expect(res.status).toBe(500);
    expect((res.body as { code: string }).code).toBe('INTERNAL');
  });
});
