import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AgentTurnResponseSchema } from '@starmap/api-contract';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../db/database.service.js';
import { ScriptedLlm } from '../llm/scripted-llm.js';
import { LLM_PORT, type LlmCompleteOptions, type LlmPort, type LlmResult } from '../llm/llm.port.js';
import { createTestSchema, type TestSchema } from '../../test/test-schema.js';
import { assertMatchesContract } from '../../test/contract.js';

/**
 * 票 08 的接口级验收。
 *
 * ## 为什么这些断言必须打在 HTTP 边界上
 *
 * 票 08 的核心不是「能不能调通模型」，而是**失败时的形状**：
 *
 * - 模型吐了非法 JSON，学生不能看到白屏或 500；
 * - 模型的措辞里带了内部推理，那些字不能出现在 DOM 里；
 * - 一轮只产出一张卡，且卡上的事实（关卡 id、题数、掌握度）来自数据库
 *   而不是模型编的。
 *
 * 这三条里任何一条，只要实现有一处把 `result.text` 直接塞进响应就会垮。
 * 单测 `parseArtifact` 只能证明「给它脏数据它能洗」，证不了「服务真的洗了」。
 *
 * ## 模型故障的四种剧本
 *
 * | 剧本 | 期望 | 为什么是这条期望 |
 * |---|---|---|
 * | 首次非法、重试合法 | 200，正常卡，`retryCount === 1` | 重试是有成本的，报告它才能看出模型稳定性 |
 * | 两次都非法 | 200，`errorCard`，`artifact === null` | 降级是**正常返回**不是 5xx：5xx 会让前端把「模型说胡话」显示成「服务挂了」 |
 * | 上游抛错 | 200，`errorCard.retryable === true`，`retryCount === 0` | 上游 5xx 是暂时的，值得让学生点「再试一次」；但重试上游只会让页面多等一个超时 |
 * | 合法但夹带内部字段 | 200，卡正常，脏字段消失 | 这是常态而不是故障，不能因此降级 |
 *
 * ## 写负向断言的人请读这一段
 *
 * 本文件里凡是 `not.toContain(...)`，**旁边必须有一条同素材的 `toContain(...)`**。
 *
 * 原因：`expect(prompt).not.toContain(答案块正文)` 在「检索根本没命中这条切片」
 * 时也恒真。第一版就踩过这个坑 —— 公式块正文里没有 query 词，BM25 没命中，
 * 于是「背景档排除了公式」这条断言在实现完全坏掉时依然绿。修法不是加超时，
 * 而是先证「同一块切片在放行的档位**确实出现过**」，再证它在别的档位消失。
 *
 * 同一个模式适用于所有「某物不该出现」的断言：先证明它在该出现的地方出现了，
 * 负向断言才有意义。否则你测的是「没找到」，不是「被排除了」。
 */

let app: INestApplication;
let schema: TestSchema;
let db: DatabaseService;

/** 用「会话里的暗号」把不同用例导向不同剧本。 */
const BROKEN_ONCE = '第一次坏掉';
const BROKEN_STICKY = '修不好';
const UPSTREAM_DOWN = '上游挂了';
const LEAKY = '泄露推理';
const CLEAN = '正常提问';
const LEVEL_CASE = '看关卡';
const RETRIEVAL_CASE = '前置放大器的噪声来源';
const FAKE_KP_CASE = '编个不存在的知识点';

const plan = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    visibleResponse: '这一步你怎么判断反馈电容的影响？',
    cardKind: 'probe_form',
    rationale: '你在问噪声，先确认这一步涉及的物理量。',
    ...extra,
  });

const inner = new ScriptedLlm([
  // 重试路径的锚点：服务端在第二次调用时把修复指令作为**最后一条 user 消息**，
  // 所以它不会与首轮的暗号互相遮蔽。
  {
    whenUserSays: '上一次的输出不是可用的 JSON',
    text: plan({ visibleResponse: '重试之后，这一步你怎么判断反馈电容的影响？' }),
  },
  { whenUserSays: BROKEN_ONCE, text: '{"visibleResponse": "这一步' },
  { whenUserSays: UPSTREAM_DOWN, text: '', fail: true },
  {
    whenUserSays: LEAKY,
    text: JSON.stringify({
      visibleResponse: '我们先看这一步的输入输出关系，它是什么？',
      cardKind: 'probe_form',
      rationale: '你在问噪声，先确认量纲。',
      // 下面三行是模型「自言自语」的典型夹带，任何一个漏进 DOM 都是缺陷
      reasoning: '学生看起来完全不会，直接给答案最快',
      answer: '120 个电子',
      _debug: { model: 'gpt-fake', score: 0.9 },
    }),
  },
  {
    whenUserSays: LEVEL_CASE,
    text: plan({ visibleResponse: '我们可以从这一关开始，先看引导。', cardKind: 'level_card' }),
  },
  // 模型自己给了一个 microKpId，但那个 id 在库里不存在（小模型很爱这么干）。
  {
    whenUserSays: FAKE_KP_CASE,
    text: plan({ microKpId: 'kp-does-not-exist', cardKind: 'graph_focus' }),
  },
  { text: plan() },
]);

/**
 * 「修不好」的模型。
 *
 * `ScriptedLlm` 只看最后一条 user 消息，而重试时最后一条恰好是修复指令 ——
 * 没法靠它表达「这个模型在修复指令下依然不合规」。真实世界里小模型确实会
 * 这样，所以这里加一层 sticky 包装：只要本次对话的任何一条 user 消息里出现过
 * 该暗号，无论第几次调用都吐同一段非法 JSON。
 */
class StickyBrokenLlm implements LlmPort {
  readonly id = 'scripted-sticky';

  constructor(
    private readonly delegate: LlmPort,
    private readonly marker: string,
  ) {}

  async complete(options: LlmCompleteOptions): Promise<LlmResult> {
    const allUserText = options.messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n');
    if (allUserText.includes(this.marker)) {
      return { text: '{"cardKind": "不存在的卡"', parsed: null };
    }
    return this.delegate.complete(options);
  }
}

const scripted = new StickyBrokenLlm(inner, BROKEN_STICKY);

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

  await q(`INSERT INTO ${schema.name}.subjects (id, name) VALUES ('nuclear', '核电子学')`);
  await q(
    `INSERT INTO ${schema.name}.modules (id, subject_id, name, tier, ordinal)
     VALUES ('m-a', 'nuclear', '信号与噪声', 'A', 1)`,
  );
  await q(
    `INSERT INTO ${schema.name}.knowledge_points (id, module_id, name, is_leaf, depth, ordinal)
     VALUES ('kp-a', 'm-a', '电荷灵敏前置放大器', true, 1, 1),
            ('kp-b', 'm-a', '成形网络', true, 1, 2)`,
  );
  // 先修边：图谱卡要读它，且方向必须正确（kp-a → kp-b，所以 kp-b 的上游是 kp-a）
  await q(
    `INSERT INTO ${schema.name}.kp_edges (from_id, to_id, kind, evidence)
     VALUES ('kp-a', 'kp-b', 'prereq', '成形网络接在前放之后')`,
  );
  await q(
    `INSERT INTO ${schema.name}.sources (id, title, kind) VALUES ('src-1', '核电子学基础', 'book')`,
  );
  await q(
    `INSERT INTO ${schema.name}.chunks (id, source_id, micro_kp_id, ordinal, kind, text, page)
     VALUES ('ck-ok', 'src-1', 'kp-a', 1, 'text',
             '电荷灵敏前置放大器的输出幅度正比于输入电荷，反馈电容决定增益。', 42),
            ('ck-ans', 'src-1', 'kp-a', 2, 'text',
             '前置放大器的噪声按等效噪声电荷计算，成形时间越长热噪声越小。', 43),
            -- 公式块：用来验证背景档不仅排答案块，也排公式/表格这类结构件。
            -- 正文里必须带上会被 query 命中的词（前置放大器 / 噪声），否则它根本
            -- 进不了候选集，"不在提示词里"就只是「没检索到」，断言会空过。
            ('ck-formula', 'src-1', 'kp-a', 3, 'formula',
             '前置放大器噪声的公式估算为 root(4kTRF) 除以成形时间。', 44),
            -- kp-b 也要有内容：推荐只挑「有内容」的叶节点，没有这一条时推荐池
            -- 只有一个候选，「多轮换焦点」就退化成「只能有一个焦点」，那条
            -- 用例会因为 probeId 每轮不同而假绿。
            ('ck-b', 'src-1', 'kp-b', 1, 'text',
             '成形网络把前放的阶跃响应压成可测量的脉冲形状，时间常数决定脉宽。', 88)`,
  );
  await q(
    `INSERT INTO ${schema.name}.chunk_kp_answer (chunk_id, micro_kp_id) VALUES ('ck-ans', 'kp-a')`,
  );
  await q(
    `INSERT INTO ${schema.name}.mastery (micro_kp_id, achieved, current, state, attempt_count, variant_count)
     VALUES ('kp-a', 0.58, 0.55, 'familiar', 4, 2)`,
  );
  await q(
    `INSERT INTO ${schema.name}.levels (id, micro_kp_id, title, kind, ordinal, spec)
     VALUES ('lv-a', 'kp-a', '前置放大器的噪声', 'teach', 1, $1::jsonb)`,
    [JSON.stringify({ meta: { estimatedMinutes: 20 }, steps: [{ kind: 'probe' }] })],
  );
  await q(
    `INSERT INTO ${schema.name}.level_items
       (id, level_id, stem, answer, explain_correct, explain_wrong, variant_group, pool)
     VALUES ('it-a', 'lv-a', '等效噪声电荷的量级是多少？',
             '{"value": 120}', '见书', '见书', 'vg-a', 'quiz')`,
  );
  // 作答证据要有 3 个变式组，但**不能挂在 lv-a 上**：关卡卡上的 itemCount 来自
  // lv-a 的真实题目数，往 lv-a 里塞题会让「关卡卡的事实是查库得来的」那条用例
  // 从 1 变 3 —— 那是测试在替实现改口径。所以另开一关 lv-a2 专门放这两道题。
  await q(
    `INSERT INTO ${schema.name}.levels (id, micro_kp_id, title, kind, ordinal, spec)
     VALUES ('lv-a2', 'kp-a', '前置放大器的噪声（进阶）', 'quiz', 2, $1::jsonb)`,
    [JSON.stringify({ meta: { estimatedMinutes: 10 }, steps: [{ kind: 'quiz' }] })],
  );
  await q(
    `INSERT INTO ${schema.name}.level_items
       (id, level_id, stem, answer, explain_correct, explain_wrong, variant_group, pool)
     VALUES ('it-a2', 'lv-a2', '反馈电容加倍后增益怎么变？',
             '{"value": 1}', '见书', '见书', 'vg-1', 'quiz'),
            ('it-a3', 'lv-a2', '成形时间常数增大时脉宽怎么变？',
             '{"value": 0}', '见书', '见书', 'vg-2', 'quiz')`,
  );
  // kp-a 的作答证据：8 条、3 个变式组，模式 CCWWCWWC。这组数字不是随手写的，
  // 是拿 replayMastery 枚举出来的：它让 evidenceSufficient 成立（>=8 条且 >=3 个
  // 变式组），同时 current 落在 0.5505 —— 既越过 FAMILIAR_THRESHOLD(0.4) 让 kp-b
  // 变成合法推荐，又没有越过 PROFICIENT_THRESHOLD(0.7) 把 kp-a 自己挤出推荐池。
  await q(
    `INSERT INTO ${schema.name}.attempts
       (micro_kp_id, item_id, variant_group, correct, counts_toward_mastery, knowledge_kind, created_at)
     VALUES ('kp-a', 'it-a',  'vg-a', true,  true, 'concept', now() - interval '8 minutes'),
            ('kp-a', 'it-a2', 'vg-1', true,  true, 'concept', now() - interval '7 minutes'),
            ('kp-a', 'it-a3', 'vg-2', false, true, 'concept', now() - interval '6 minutes'),
            ('kp-a', 'it-a',  'vg-a', false, true, 'concept', now() - interval '5 minutes'),
            ('kp-a', 'it-a2', 'vg-1', true,  true, 'concept', now() - interval '4 minutes'),
            ('kp-a', 'it-a3', 'vg-2', false, true, 'concept', now() - interval '3 minutes'),
            ('kp-a', 'it-a',  'vg-a', false, true, 'concept', now() - interval '2 minutes'),
            ('kp-a', 'it-a2', 'vg-1', true,  true, 'concept', now() - interval '1 minutes')`,
  );
}, 60_000);

afterAll(async () => {
  await app?.close();
  await schema?.drop();
});

interface TurnBody {
  turnId: string;
  sessionId: string;
  artifact:
    | {
        kind: string;
        cardId: string;
        title: string;
        microKpId?: string;
        levelId?: string;
        itemCount?: number;
        estimatedMinutes?: number;
        firstStepKind?: string;
        question?: string;
        probeId?: string;
        neighbors?: unknown[];
      }
    | null;
  errorCard: { title: string; detail: string; retryable: boolean; debugId: string } | null;
  degraded: boolean;
  retryCount: number;
  visibleResponse: string;
  visibleResponseKind: string;
  languageCheck: { ok: boolean; offenders: string[] };
  actions: Array<{ kind: string; label: string; enabled: boolean }>;
}

let sessionSeq = 0;
/** 每个用例自己一个会话：起点掌握度快照与日志互不污染。 */
function freshSession(): string {
  sessionSeq += 1;
  return `ses-test-${sessionSeq}`;
}

async function turn(
  sessionId: string,
  utterance: string,
  microKpId: string | null = 'kp-a',
): Promise<TurnBody> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/agent/turns')
    .send({ sessionId, utterance, microKpId, tier: 'P1' })
    .expect(200);
  assertMatchesContract('/api/v1/agent/turns', 'post', 200, res.body);
  return res.body as TurnBody;
}

describe('一轮只产出一张卡，且卡片形状受契约约束', () => {
  it('正常一轮返回四张卡之一，且恰好一张', async () => {
    const body = await turn(freshSession(), CLEAN);

    expect(body.degraded).toBe(false);
    expect(body.errorCard).toBeNull();
    expect(body.artifact).not.toBeNull();
    expect(['level_card', 'graph_focus', 'progress_change', 'probe_form']).toContain(
      body.artifact?.kind,
    );
    // 服务端在边界上再 parse 一次：出了契约字段，前端会静默拿到 undefined。
    expect(() => AgentTurnResponseSchema.parse(body)).not.toThrow();
  });

  it('卡片的 id 与时间来自服务端，不是模型编的', async () => {
    const body = await turn(freshSession(), CLEAN);

    expect(body.artifact?.cardId).toBe(body.turnId);
    expect(body.artifact?.cardId).toMatch(/^at-/);

    const created = new Date(body.artifact?.cardId ? (body.artifact as never as { createdAt: string }).createdAt : '')
      .getTime();
    expect(Number.isNaN(created)).toBe(false);
    expect(Math.abs(Date.now() - created)).toBeLessThan(5 * 60_000);
  });

  it('关卡卡上的事实是查库得来的（题数、预计用时、第一步）', async () => {
    const body = await turn(freshSession(), LEVEL_CASE);

    expect(body.artifact?.kind).toBe('level_card');
    // 模型只说了 cardKind；levelId / itemCount / estimatedMinutes 全部来自 app.levels
    expect(body.artifact?.levelId).toBe('lv-a');
    expect(body.artifact?.itemCount).toBe(1);
    expect(body.artifact?.estimatedMinutes).toBe(20);
    expect(body.artifact?.firstStepKind).toBe('probe');
  });

  it('没有知识点时服务端按推荐挑一个焦点，走完整路径而不是占位卡', async () => {
    // t49：以前这里返回一张「先在知识地图上选一个点」的空图谱卡，而且每一轮都是它。
    // 现在服务端用推荐（recommend.service.ts，与看板/图谱同源）挑一个焦点。
    const body = await turn(freshSession(), CLEAN, null);

    expect(body.degraded).toBe(false);
    expect(body.artifact).not.toBeNull();
    // 占位卡的唯一特征是 microKpId 为空串 + 标题让人去选点；这里必须不是它。
    expect(body.artifact?.microKpId).not.toBe('');
    expect(body.artifact?.title).not.toBe('先在知识地图上选一个点');
    // 挑出来的必须是真实存在的知识点，而不是模型编的字符串。
    const picked = body.artifact?.microKpId as string;
    const rows = await db.query<{ id: string }>(
      'SELECT id FROM knowledge_points WHERE id = $1',
      [picked],
    );
    expect(rows).toHaveLength(1);
  });

  it('连续多轮不传知识点，也不该反复得到同一张卡', async () => {
    const sessionId = freshSession();
    const focuses: string[] = [];
    const cards: string[] = [];

    for (const utterance of [CLEAN, CLEAN, CLEAN, CLEAN, CLEAN]) {
      const body = await turn(sessionId, utterance, null);
      expect(body.degraded).toBe(false);
      expect(body.artifact?.microKpId).not.toBe('');
      focuses.push(body.artifact?.microKpId ?? '');
      // 只比 cardId 是不够的：cardId 等于当轮 turnId，永远唯一 —— 那样这条断言
      // 在「五轮全是同一张占位卡」的旧实现下也会绿。同理 probe_form 卡里有每轮
      // 新建的 probeId，只比整张卡的内容也会假绿。所以这里只比**焦点**。
      cards.push(JSON.stringify({ microKpId: body.artifact?.microKpId }));
    }

    // 推荐池里有两个有内容的叶节点（kp-a / kp-b），轮换必须把它们都用上。
    expect(new Set(focuses).size).toBeGreaterThan(1);
    // 更硬的一条：相邻两轮不能是同一个点。只要求「整体不止一个」时，
    // 1→1→1→1→2 也算通过，而那对学生仍然是「前四轮在讲同一件事」。
    for (let i = 1; i < focuses.length; i += 1) {
      expect(focuses[i]).not.toBe(focuses[i - 1]);
    }
    expect(new Set(cards).size).toBeGreaterThan(1);
  });

  it('推荐也为空时（空库）才给占位卡，并在理由里说清是服务端没得推荐', async () => {
    // 这里必须换一个**只有表结构、没有内容**的 schema：推荐是按「有内容的叶节点」
    // 过滤的，只要库里有任何一块 chunk 就挑得出焦点，占位卡分支永远走不到。
    const emptySchema = await createTestSchema();
    try {
      await db.useSchema(emptySchema.name);

      const body = await turn(freshSession(), CLEAN, null);

      expect(body.degraded).toBe(false);
      expect(body.artifact?.kind).toBe('graph_focus');
      expect(body.artifact?.microKpId).toBe('');
      expect(body.artifact?.neighbors).toEqual([]);
      // 理由必须说清「服务端也没得推荐」，否则学生会以为是按钮坏了。
      const rationale = (body.artifact as { rationale?: string }).rationale ?? '';
      expect(rationale).toContain('服务端此刻也没有可推荐的节点');
    } finally {
      await db.useSchema(schema.name);
      await emptySchema.drop();
    }
  });

  it('模型编了一个不存在的知识点时，不 500，改用服务端焦点', async () => {
    // 不校验的话 buildArtifact 会拿这个 id 去 probe.start()，抛 NotFoundException
    // 变成整轮 500 —— 学生看到的是错误页，而不是「模型跑偏了但卡还在」。
    const body = await turn(freshSession(), FAKE_KP_CASE);

    expect(body.degraded).toBe(false);
    expect(body.artifact).not.toBeNull();
    expect(body.artifact?.microKpId).not.toBe('kp-does-not-exist');
    expect(body.artifact?.microKpId).toBe('kp-a');
  });
});

describe('模型的内部推理不得进入响应（更不得进 DOM）', () => {
  it('reasoning / answer / _debug 被剥离，卡本身不受影响', async () => {
    const body = await turn(freshSession(), LEAKY);

    /*
     * 断言口径要收窄到「学生看得见的部分」。
     *
     * 原来断言整个响应体不含 `reasoning` 这个词——但迁移 0072 起，
     * `trace.model.reasoning` 是**合法的元数据键**（模型给了推理内容就记下，
     * 没给就是 null），它是给人看决策链用的，不是模型内部字段泄漏。
     * 整包禁用这个词等于把「元数据」和「泄漏」混为一谈，会让这条测试
     * 长期红着而无人敢改。
     *
     * 真正要防的是：模型塞进 JSON 的 `reasoning`/`answer`/`_debug` 字段
     * 有没有流进**可见回复**与**卡片正文**——那才是学生看得到的表面。
     */
    const visibleSurface = JSON.stringify({
      visibleResponse: body.visibleResponse,
      artifact: body.artifact,
      errorCard: body.errorCard,
    });
    expect(visibleSurface).not.toContain('reasoning');
    expect(visibleSurface).not.toContain('_debug');
    // 模型名属元数据，只允许出现在 trace 里，不允许出现在可见面上
    expect(visibleSurface).not.toContain('gpt-fake');
    // 响应体整体仍不得出现模型塞进来的两个泄漏值（这两个值是内容，不是键名）
    expect(JSON.stringify(body)).not.toContain('直接给答案最快');
    expect(JSON.stringify(body)).not.toContain('120 个电子');

    // 剥字段不等于把卡废掉
    expect(body.artifact?.kind).toBe('probe_form');
    expect(body.artifact?.question).toContain('输入输出关系');
  });

  it('夹带内部字段是常态而非故障：不能让整轮降级', async () => {
    const body = await turn(freshSession(), LEAKY);
    expect(body.degraded).toBe(false);
    expect(body.errorCard).toBeNull();
  });
});

describe('模型输出非法时：重试一次，仍失败则降级而不是 500', () => {
  it('首次非法、重试合法 → 正常卡，且 retryCount 如实报告', async () => {
    const body = await turn(freshSession(), BROKEN_ONCE);

    expect(body.degraded).toBe(false);
    expect(body.artifact).not.toBeNull();
    expect(body.retryCount).toBe(1);
    expect(body.artifact?.question).toContain('重试之后');
  });

  it('修复指令也救不回来 → 200 + 可读错误卡，不是白屏也不是 5xx', async () => {
    const body = await turn(freshSession(), BROKEN_STICKY);

    expect(body.degraded).toBe(true);
    expect(body.artifact).toBeNull();
    expect(body.errorCard).not.toBeNull();
    expect(body.errorCard?.title).toBe('这次没能生成卡片');
    // 可读：中文、非空、不含 zod 的英文技术词
    expect(body.errorCard?.detail.length).toBeGreaterThan(0);
    expect(body.errorCard?.detail).not.toContain('ZodError');
    expect(body.errorCard?.detail).not.toContain('invalid_type');
    expect(body.errorCard?.debugId).toMatch(/^[0-9a-f]{12}$/);
    expect(body.retryCount).toBe(1);
  });

  it('降级轮也有可见回复，且形态自洽', async () => {
    const body = await turn(freshSession(), BROKEN_STICKY);

    expect(body.visibleResponse.length).toBeGreaterThan(0);
    if (body.visibleResponseKind === 'probe_question') {
      expect(body.visibleResponse).toMatch(/[?？]\s*$/);
    }
  });

  it('上游抛错 → 可重试的错误卡，但 HTTP 仍是 200 且不重试', async () => {
    const body = await turn(freshSession(), UPSTREAM_DOWN);

    expect(body.degraded).toBe(true);
    expect(body.errorCard?.retryable).toBe(true);
    expect(body.errorCard?.title).toBe('模型暂时不可用');
    // 上游错误不重试：重试只会让页面多等一个超时
    expect(body.retryCount).toBe(0);
  });
});

describe('每轮都能回看：卡是持久的，不是流', () => {
  it('学习日志按顺序返回同一会话的所有轮', async () => {
    const sessionId = freshSession();
    const first = await turn(sessionId, CLEAN);
    const second = await turn(sessionId, CLEAN);

    const res = await request(app.getHttpServer())
      .get('/api/v1/agent/turns')
      .query({ sessionId })
      .expect(200);
    assertMatchesContract('/api/v1/agent/turns', 'get', 200, res.body);

    const items = (res.body as { items: Array<{ turnId: string }> }).items;
    expect(items.map((i) => i.turnId)).toEqual([first.turnId, second.turnId]);
  });

  it('回看单轮是原样重放：卡片与回复与当时一致', async () => {
    const created = await turn(freshSession(), CLEAN);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/agent/turns/${created.turnId}`)
      .expect(200);
    assertMatchesContract('/api/v1/agent/turns/{turnId}', 'get', 200, res.body);

    const replayed = res.body as TurnBody;
    expect(replayed.turnId).toBe(created.turnId);
    // 重放不重新调模型：同一个问题两次生成的卡不一样，历史会自己变形
    expect(replayed.artifact).toEqual(created.artifact);
    expect(replayed.visibleResponse).toBe(created.visibleResponse);
    expect(replayed.degraded).toBe(created.degraded);
  });

  it('降级轮的 errorCard 也能回看（detail/debugId 不能刷新即丢）', async () => {
    const created = await turn(freshSession(), BROKEN_STICKY);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/agent/turns/${created.turnId}`)
      .expect(200);

    const replayed = res.body as TurnBody;
    expect(replayed.degraded).toBe(true);
    expect(replayed.errorCard?.debugId).toBe(created.errorCard?.debugId);
    expect(replayed.errorCard?.detail).toBe(created.errorCard?.detail);
  });

  it('不存在的回合 404，不是 500', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/agent/turns/at-does-not-exist')
      .expect(404);
    assertMatchesContract('/api/v1/agent/turns/{turnId}', 'get', 404, res.body);
    expect((res.body as { code: string }).code).toBe('NOT_FOUND');
  });
});

describe('「看依据」展示本轮用到了什么、排除了什么', () => {
  it('依据清单逐条带 allowed 与排除原因，且与门控结论一致', async () => {
    const created = await turn(freshSession(), RETRIEVAL_CASE);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/agent/turns/${created.turnId}/evidence`)
      .expect(200);
    assertMatchesContract('/api/v1/agent/turns/{turnId}/evidence', 'get', 200, res.body);

    const body = res.body as {
      turnId: string;
      gateTier: string;
      items: Array<{
        chunkId: string;
        allowed: boolean;
        isAnswerChunk: boolean;
        exclusionReason: string | null;
      }>;
    };

    expect(body.turnId).toBe(created.turnId);
    // 掌握度 current = 0.55 → 脚手架档
    expect(body.gateTier).toBe('scaffold');
    expect(body.items.length).toBeGreaterThan(0);

    for (const item of body.items) {
      if (item.allowed) {
        expect(item.exclusionReason, `允许的切片不该有排除原因：${item.chunkId}`).toBeNull();
      } else {
        expect(item.exclusionReason, `被排除的切片必须说明原因：${item.chunkId}`).toBeTruthy();
      }
    }

    // 答案块必须被标出来并且被排除（脚手架档不给答案）
    const answer = body.items.find((i) => i.chunkId === 'ck-ans');
    expect(answer, '本轮检索命中里应当包含 ck-ans').toBeDefined();
    expect(answer?.isAnswerChunk).toBe(true);
    expect(answer?.allowed).toBe(false);
    expect(answer?.exclusionReason).toContain('答案');
  });

  it('不存在的回合取依据 404', async () => {
    await request(app.getHttpServer()).get('/api/v1/agent/turns/at-nope/evidence').expect(404);
  });
});

describe('门控在检索层，不在提示词里', () => {
  /**
   * 这一组断言的对象是**实际发给模型的字节**，不是接口返回体。
   *
   * 「不给答案」有两种实现方式：在提示词里写「请不要透露答案」，或者让答案根本
   * 不在提示词里。前者在模型不听话时立刻失效，而且从外部完全看不出来 —— 接口
   * 返回体、调试器、日志都会显示一切正常。所以必须直接检查 `LlmPort` 收到的
   * `messages`：被门控排除的切片，其正文不得出现在任何一条消息里。
   *
   * 反向断言同样重要：允许的切片**必须**在，否则「不在」可能只是因为检索根本没
   * 命中，测试就会在实现完全坏掉时依然通过。
   */

  const promptText = (): string => {
    const call = inner.calls[inner.calls.length - 1];
    if (!call) throw new Error('模型一次都没被调用，无法检查提示词');
    return call.messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');
  };

  // 两块切片的正文在种子里是唯一的，用它们做「在 / 不在」的判据。
  const ALLOWED_TEXT = '反馈电容决定增益';
  const ANSWER_TEXT = '成形时间越长热噪声越小';

  it('脚手架档：允许的切片进了提示词，答案块的正文一个字都没有', async () => {
    await turn(freshSession(), RETRIEVAL_CASE);

    const prompt = promptText();
    expect(prompt, '允许的切片应当在提示词里，否则本用例证明不了排除是有选择性的').toContain(
      ALLOWED_TEXT,
    );
    expect(prompt, '答案块被门控排除后，正文不得出现在发给模型的任何一条消息里').not.toContain(
      ANSWER_TEXT,
    );
    // 连「别用这条」这种痕迹都不该有 —— 那说明还在靠提示词约束
    expect(prompt).not.toContain('ck-ans');
  });

  it('全量档：同一块切片的正文确实会出现（证明排除是档位驱动的，不是无差别剔除）', async () => {
    // 同一个知识点提到全量档；本用例结束前改回，避免污染同文件的其他用例。
    const q = (sql: string, params: readonly unknown[] = []) => db.query(sql, params);
    await q(
      `UPDATE ${schema.name}.mastery SET current = 0.85, achieved = 0.9 WHERE micro_kp_id = 'kp-a'`,
    );

    try {
      await turn(freshSession(), RETRIEVAL_CASE);
      const prompt = promptText();
      expect(
        prompt,
        '掌握度过 0.7 之后答案块应当被放行并进入提示词；否则说明实现是无差别删掉答案块，而不是按档位门控',
      ).toContain(ANSWER_TEXT);
      expect(prompt).toContain(ALLOWED_TEXT);
    } finally {
      await q(
        `UPDATE ${schema.name}.mastery SET current = 0.55, achieved = 0.58 WHERE micro_kp_id = 'kp-a'`,
      );
    }
  });

  it('背景档：公式块也不进提示词（背景档只给叙述性文本与图示）', async () => {
    const q = (sql: string, params: readonly unknown[] = []) => db.query(sql, params);

    // 正向对照：脚手架档必须放行 ck-formula，证明它确实被检索命中过
    // （否则后面那条「背景档不含公式」会变成永远成立的空断言）。
    await q(
      `UPDATE ${schema.name}.mastery SET current = 0.55, achieved = 0.58 WHERE micro_kp_id = 'kp-a'`,
    );
    await turn(freshSession(), RETRIEVAL_CASE);
    expect(
      promptText(),
      '脚手架档应当放行公式块；若不出现，说明后面那条背景档断言是空的',
    ).toContain('root(4kTRF)');

    // 反向断言：背景档把它拿掉。
    await q(
      `UPDATE ${schema.name}.mastery SET current = 0.2, achieved = 0.25 WHERE micro_kp_id = 'kp-a'`,
    );
    try {
      await turn(freshSession(), RETRIEVAL_CASE);
      const prompt = promptText();
      expect(prompt, '背景档不该把公式块送进提示词').not.toContain('root(4kTRF)');
      expect(prompt, '背景档仍应给叙述性文本').toContain(ALLOWED_TEXT);
      expect(prompt, '背景档同样不得放行答案块').not.toContain(ANSWER_TEXT);
    } finally {
      // 恢复脚手架档，避免污染同文件后续用例（vitest 同文件内顺序执行）。
      await q(
        `UPDATE ${schema.name}.mastery SET current = 0.55, achieved = 0.58 WHERE micro_kp_id = 'kp-a'`,
      );
    }
  });
});

describe('入参校验在边界上拦住，不进服务', () => {
  it('缺 utterance 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/agent/turns')
      .send({ sessionId: 'ses-x' })
      .expect(400);
    assertMatchesContract('/api/v1/agent/turns', 'post', 400, res.body);
    expect((res.body as { code: string }).code).toBe('VALIDATION_FAILED');
  });

  it('超长 utterance 400（不截断：截断会静默改变学生的输入）', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/agent/turns')
      .send({ sessionId: 'ses-x', utterance: 'a'.repeat(2001) })
      .expect(400);
  });

  it('缺 sessionId 的日志查询 400', async () => {
    await request(app.getHttpServer()).get('/api/v1/agent/turns').expect(400);
  });
});

/**
 * t56：学习者这句话里的知识点名，优先于「按进度推荐」。
 *
 * ## 这一组为什么要打在 HTTP 上
 *
 * `matchFocus` 的单测能证明「给它一句话和一串候选，它能挑对」。它证不了
 * 服务真的把学习者的话读进去了 —— 2026-10-22 的实测就是这样：连说三句
 * 不同主题（布尔代数 / 中子探测 / 能量分辨率），三张卡的焦点全是推荐列表
 * 的第一个点，学生说的是「布尔代数」，卡片讲的是「放射性衰变」。
 *
 * 所以这里断言的是**可观测的结果**：响应的 `artifact.microKpId` 与提示词里
 * 那句「这个点是怎么来的」。两条都要，因为焦点对了但提示词没说清来路时，
 * 模型会把她没说的话安到她头上（「你刚才说的放射性衰变…」）。
 *
 * ## 为什么用「连说两轮」和「不在推荐池里的点」来证伪
 *
 * - 只断言「说了成形网络就得到 kp-b」不够：推荐轮转恰好轮到 kp-b 时也绿。
 *   加上「同一句话连说两轮，两轮都是 kp-b」才排掉轮转这个巧合通道。
 * - `kp-c（能量分辨率）` 故意不给任何 chunk。推荐只挑「有内容的叶节点」，
 *   所以它**永远进不了推荐池**；它能被选中，只可能是听了原话。
 */
describe('学习者这句话里的知识点名优先于推荐（t56）', () => {
  it('说了库里存在的知识点名，焦点就是它', async () => {
    const body = await turn(freshSession(), '成形网络这一块我搞不清', null);
    expect(body.degraded).toBe(false);
    expect(body.artifact?.microKpId).toBe('kp-b');
  });

  it('同一句话连说两轮，焦点不因推荐轮换而漂走', async () => {
    const sessionId = freshSession();
    const first = await turn(sessionId, '成形网络的脉宽怎么定', null);
    const second = await turn(sessionId, '成形网络的脉宽怎么定', null);

    expect(first.artifact?.microKpId).toBe('kp-b');
    expect(second.artifact?.microKpId).toBe('kp-b');
  });

  it('匹配到的是原话里那个点，而不是推荐池轮到的那个', async () => {
    // kp-c 没有任何 chunk，永远进不了推荐池（推荐只挑有内容的叶节点）。
    // 用 try/finally 是为了不让这一行脏数据影响同文件里其它用例的推荐池。
    await db.query(
      `INSERT INTO knowledge_points (id, module_id, name, is_leaf, depth, ordinal)
       VALUES ('kp-c', 'm-a', '能量分辨率', true, 1, 9)`,
    );
    try {
      const chunks = await db.query<{ n: string }>(
        `SELECT count(*) AS n FROM chunks WHERE micro_kp_id = 'kp-c'`,
      );
      expect(Number(chunks[0]?.n)).toBe(0);

      const body = await turn(freshSession(), '能量分辨率受什么影响', null);
      expect(body.artifact?.microKpId).toBe('kp-c');
    } finally {
      await db.query(`DELETE FROM knowledge_points WHERE id = 'kp-c'`);
    }
  });

  it('说了一句库里没有的话 → 回落到推荐，且下一轮会换（与匹配分支可区分）', async () => {
    const sessionId = freshSession();
    const first = await turn(sessionId, '今天天气不错', null);
    const second = await turn(sessionId, '今天天气不错', null);

    // 不是占位卡：推荐池里有东西
    expect(first.artifact?.microKpId).not.toBe('');
    expect(first.artifact?.microKpId).not.toBeNull();
    // 推荐分支会轮换 —— 这正是「匹配」与「推荐」两条分支可观测的差别：
    // 同一句话，匹配到的点两轮不变，推荐挑的点两轮必然不同。
    expect(second.artifact?.microKpId).not.toBe(first.artifact?.microKpId);
  });

  it('提示词说明焦点的来路：匹配到就说「她刚才说的」，回落就说「不是她说的」', async () => {
    // 提示词是模型唯一能看到的「这个焦点是谁定的」。它写错了，模型就会
    // 把推荐出来的点说成学习者提的 —— 这正是 t56 之前的现象之一。
    const matchedBefore = inner.calls.length;
    await turn(freshSession(), '成形网络这一块我搞不清', null);
    const matchedPrompt =
      inner.calls[matchedBefore]?.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(matchedPrompt).toContain('学习者刚才那句话里提到的');
    expect(matchedPrompt).toContain('成形网络');

    const recommendedBefore = inner.calls.length;
    await turn(freshSession(), '今天天气不错', null);
    const recommendedPrompt =
      inner.calls[recommendedBefore]?.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(recommendedPrompt).toContain('不是你刚说的');
  });

  it('显式传了 microKpId 时，说的话不能把它挤掉（显式选择最高优先）', async () => {
    // 「成形网络」会被匹配到 kp-b，但请求里点名要 kp-a —— 以点名为准。
    const body = await turn(freshSession(), '成形网络这一块我搞不清', 'kp-a');
    expect(body.artifact?.microKpId).toBe('kp-a');
  });

  it('同一会话里改口，焦点跟着改（不锁死在第一次匹配上）', async () => {
    const sessionId = freshSession();
    const first = await turn(sessionId, '成形网络这一块我搞不清', null);
    const second = await turn(sessionId, '前置放大器的噪声怎么算', null);

    expect(first.artifact?.microKpId).toBe('kp-b');
    expect(second.artifact?.microKpId).toBe('kp-a');
  });
});
