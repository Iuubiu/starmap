/**
 * `probe` 阶段的会话驱动逻辑单测（假 StageApi，不起浏览器、不打后端）。
 *
 * ## 这条测试防的是什么
 *
 * 三级施压最容易被写成「发三句话、数一下有没有泄露」。但真正要测的是三件
 * 各自会独立出错的事：
 *
 * 1. **每级必须是独立会话** —— 同一会话连发三句测的是「第 N 轮」而不是
 *    「第 N 级」。追问状态机有计数器与阶梯，第 1 轮和第 3 轮的上限完全不同。
 *    如果谁把三个 `POST /agent/probes` 改成一次，这里会红。
 * 2. **单级失败不能污染另外两级** —— 拿不到会话就该如实报错，而不是把
 *    已经采到的观察一起丢掉（那会让 L1 的样本凭空消失）。
 * 3. **409/404 是「没内容」不是「产品坏了」** —— 后端对没有可追问题目的
 *    知识点返回 409 是正确行为，阶段要记 `skippedReason` 并判 passed。
 *
 * ## 为什么用假 StageApi
 *
 * 真打后端就得起服务、造知识点、造关卡，测的是环境而不是驱动逻辑。假 API
 * 可以把「第 2 级创建会话时返回 409」这件事写成确定性的，于是它测的才是
 * 阶段自己怎么处理这种情况。
 */

import { describe, expect, it } from 'vitest';
import type { StageApi } from '../src/layer2/stages.ts';
import {
  collectPressureObservations,
  leakCountsByTier,
  pickCriteria,
  PRESSURE_LEVELS,
} from '../src/layer2/stage-probe.ts';

/** 一道有 4 个选项、答案下标 1 的判定题。 */
const SPEC = {
  items: [
    { id: 'i-1', stem: 'A + A·B = ?', options: ['A·B', 'A + A·B = A', 'B', 'A + B'], answer: 1, explainCorrect: '吸收律：A + A·B = A。' },
    { id: 'i-2', stem: '干扰项', options: ['甲', '乙'], answer: 0, explainCorrect: '这道题不在 quiz 段。' },
  ],
  steps: [
    { kind: 'detail', itemIds: [] },
    { kind: 'quiz', itemIds: ['i-1'] },
  ],
};

interface Call {
  method: 'GET' | 'POST';
  path: string;
  body: unknown;
}

/**
 * 造一个假 StageApi。
 *
 * `replies` 按调用顺序消费：每次 `POST /agent/probes/:id/replies` 取一个元素
 * 当响应体。用「按顺序」而不是「按内容」是因为被测代码每一轮发的是同一句话
 * —— 内容无法区分轮次，而轮次正是要断言的东西。
 */
function fakeApi(options: {
  replies: Array<Record<string, unknown>>;
  createStatus?: number;
  replyStatus?: number;
}): { api: StageApi; calls: Call[] } {
  const calls: Call[] = [];
  let replyIndex = 0;
  const api: StageApi = {
    async getJson(path) {
      calls.push({ method: 'GET', path, body: null });
      if (path.startsWith('/market/levels')) {
        return { status: 200, body: { items: [{ levelId: 'lv-test', microKpId: 'kp-test' }] }, rawText: '' };
      }
      if (path.startsWith('/levels/')) return { status: 200, body: { level: {}, spec: SPEC }, rawText: '' };
      return { status: 404, body: {}, rawText: '' };
    },
    async postJson(path, body) {
      calls.push({ method: 'POST', path, body });
      if (path === '/agent/probes') {
        const status = options.createStatus ?? 200;
        return { status, body: status === 200 ? { probeId: `probe-${String(calls.length)}` } : {}, rawText: '' };
      }
      const status = options.replyStatus ?? 200;
      if (status !== 200) return { status, body: {}, rawText: '出错了' };
      const reply = options.replies[replyIndex] ?? { question: '', action: 'exit' };
      replyIndex += 1;
      return { status: 200, body: reply, rawText: '' };
    },
  };
  return { api, calls };
}

/** 三级各 3 轮、全部「继续追问且不泄露」的回复。 */
function nineSafeReplies(): Array<Record<string, unknown>> {
  return Array.from({ length: 9 }, () => ({
    question: '你先说说，A + A·B 里这两项分别是什么？',
    action: 'hint',
    judge: { passed: true },
  }));
}

describe('409/404 是「没内容」不是「产品坏了」', () => {
  function apiWith(startStatus: number, replyStatus = 200): StageApi {
    return {
      getJson: async (path) => {
        if (path.startsWith('/levels/')) {
          return {
            status: 200,
            body: {
              spec: {
                items: [{ id: 'i-1', stem: '题', options: ['甲', '乙'], answer: 0, explainCorrect: '因为甲。' }],
                steps: [{ kind: 'quiz', itemIds: ['i-1'] }],
              },
            },
            rawText: '',
          };
        }
        return {
          status: 200,
          body: { items: [{ levelId: 'lv-1', microKpId: 'kp-1' }] },
          rawText: '',
        };
      },
      postJson: async (path) => {
        if (path === '/agent/probes') {
          return startStatus === 200
            ? { status: 200, body: { probeId: 'pr-1' }, rawText: '' }
            : { status: startStatus, body: { code: 'NOT_FOUND' }, rawText: '{}' };
        }
        if (replyStatus !== 200) return { status: replyStatus, body: {}, rawText: '{}' };
        return {
          status: 200,
          body: { question: '再想一想？', action: 'hint', ladder: { exited: true } },
          rawText: '',
        };
      },
    };
  }

  it('创建会话返回 404 时记 skippedReason，不是 error', async () => {
    const { data, error } = await collectPressureObservations(apiWith(404), 'kp-1');
    expect(error).toBeNull();
    expect(data.skippedReason).toContain('404');
    expect(data.observations).toEqual([]);
  });

  it('创建会话返回 409 时同样记 skippedReason', async () => {
    const { data, error } = await collectPressureObservations(apiWith(409), 'kp-1');
    expect(error).toBeNull();
    expect(data.skippedReason).toContain('409');
  });

  it('5xx 仍然是 error（那是产品坏了）', async () => {
    const { error } = await collectPressureObservations(apiWith(500), 'kp-1');
    expect(error).toContain('500');
  });

  it('追问轮次返回 404 时保留已采到的观察并记 skippedReason', async () => {
    const { data, error } = await collectPressureObservations(apiWith(200, 404), 'kp-1');
    expect(error).toBeNull();
    expect(data.skippedReason).toContain('404');
    expect(data.observations).toEqual([]);
  });
});

describe('施压台词不能触发状态机的「放弃」分支', () => {
  /* 与 `packages/engine/src/probe.ts` 的 GIVE_UP_PATTERNS / FRUSTRATION_PATTERNS
     逐字一致。评估器不能 import engine（`tools/eval` 的依赖里没有它），
     所以这里抄一份 —— 但抄的那份必须与产品一致，否则这条测试就失去意义。
     下面第二条用例就是防「抄的这份过期了」：从 engine 源码里读正则来比对。 */
  const GIVE_UP = [/直接告诉/, /告诉我答案/, /给?我答案/, /直接给/, /看答案/, /不会做你讲/];
  const FRUSTRATION = [/太难/, /不想做/, /烦/, /放弃/, /受不了/, /换个/, /没意思/];

  it('三级施压的台词都不命中 give_up / frustration 关键词', () => {
    for (const level of PRESSURE_LEVELS) {
      const hit = [...GIVE_UP, ...FRUSTRATION].filter((pattern) => pattern.test(level.utterance));
      expect(
        hit.map((pattern) => pattern.source),
        `${level.label} 的台词「${level.utterance}」命中了 ${hit.map((p) => p.source).join('、')}，` +
          '状态机会直接 reveal，采到的就不是「施压」而是「学生放弃时的揭晓」',
      ).toEqual([]);
    }
  });

  it('本地抄的正则与 packages/engine/src/probe.ts 一致（防止产品改了这边没跟上）', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const engine = readFileSync(resolve(here, '../../../packages/engine/src/probe.ts'), 'utf8');

    const extract = (name: string): string[] => {
      const match = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(engine);
      if (match === null) return [];
      return [...(match[1] ?? '').matchAll(/\/([^/]+)\//g)].map((entry) => entry[1] ?? '');
    };

    expect(extract('GIVE_UP_PATTERNS')).toEqual(GIVE_UP.map((pattern) => pattern.source));
    expect(extract('FRUSTRATION_PATTERNS')).toEqual(FRUSTRATION.map((pattern) => pattern.source));
  });
});

describe('pickCriteria：从 spec 里挑判据', () => {
  it('优先取 quiz 段的题，而不是数组第一题', () => {
    const criteria = pickCriteria(SPEC);
    expect(criteria?.correctOptionText).toBe('A + A·B = A');
    expect(criteria?.explainCorrect).toContain('吸收律');
  });

  it('没有 quiz 段时退回第一道有选项的题（跳过填空题）', () => {
    const items = [
      { id: 'blank', stem: '填空：A + A·B = ？', answer: 'A', explainCorrect: '填空题解析' },
      { id: 'choice', stem: '选择：A + A·B = ？', options: ['甲', '乙'], answer: 0, explainCorrect: '选择题解析' },
    ];
    const criteria = pickCriteria({ items, steps: [] });
    expect(criteria?.correctOptionText).toBe('甲');
  });

  it('spec 是空壳 / null 时返回 null（不是抛异常）', () => {
    expect(pickCriteria(null)).toBeNull();
    expect(pickCriteria({})).toBeNull();
    expect(pickCriteria({ items: [] })).toBeNull();
  });

  it('答案下标越界时 correctOptionText 为 null（不误判成第 0 项）', () => {
    const criteria = pickCriteria({ items: [{ id: 'x', options: ['甲'], answer: 5, explainCorrect: '解析' }] });
    expect(criteria?.correctOptionText).toBeNull();
  });
});

describe('collectPressureObservations：三级会话', () => {
  it('三级各开一个独立会话，不是同一会话连发九句', async () => {
    const { api, calls } = fakeApi({ replies: nineSafeReplies() });
    const { data, error } = await collectPressureObservations(api, 'kp-test');

    expect(error).toBeNull();
    const creates = calls.filter((call) => call.path === '/agent/probes');
    expect(creates).toHaveLength(3);
    /* 请求里的 `tier` 是**学习者档位**（P1/P2/P3），不是施压级别 —— 后端
       `ProbeStartRequestSchema.tier` 是 `LearnerTierSchema`，发 `L1` 会 400。
       这一点本地假 API 拦不住，所以必须在这里断言。 */
    expect(creates.map((call) => (call.body as { tier: string }).tier)).toEqual(['P1', 'P1', 'P1']);

    /* 每一级的 probeId 都不同 —— 同一个会话被复用会让三次施压落在同一状态机上。 */
    expect(new Set(data.sessions.map((session) => session.probeId)).size).toBe(3);
    expect(data.observations).toHaveLength(9);
  });

  it('请求里的 tier 透传 persona 档位（P2 → 三次都发 P2）', async () => {
    const { api, calls } = fakeApi({ replies: nineSafeReplies() });
    await collectPressureObservations(api, 'kp-test', 'P2');
    const creates = calls.filter((call) => call.path === '/agent/probes');
    expect(creates.map((call) => (call.body as { tier: string }).tier)).toEqual(['P2', 'P2', 'P2']);
  });

  it('每级观察都带上该级的 tier 与轮次', async () => {
    const { api } = fakeApi({ replies: nineSafeReplies() });
    const { data } = await collectPressureObservations(api, 'kp-test');

    for (const level of PRESSURE_LEVELS) {
      const rounds = data.observations.filter((observation) => observation.tier === level.tier).map((o) => o.round);
      expect(rounds, level.tier).toEqual([1, 2, 3]);
    }
  });

  it('系统贴出正确选项原文时该轮记 answer_text', async () => {
    const replies = nineSafeReplies();
    replies[6] = { question: '好吧，吸收律：A + A·B = A', action: 'reveal', judge: { passed: true } };
    const { api } = fakeApi({ replies });
    const { data } = await collectPressureObservations(api, 'kp-test');

    const counts = leakCountsByTier(data.observations);
    expect(counts.L3.leaked).toBe(1);
    expect(counts.L3.kinds.answer_text).toBe(1);
    expect(counts.L1.leaked).toBe(0);
  });

  it('L3 仍在追问的轮数单独计数（L1/L2 继续追问是合理的，不算过度）', async () => {
    const replies = nineSafeReplies();
    /* L3 的三轮：前两轮 hint（还在追问）、第三轮 acknowledge（收束）。 */
    replies[6] = { question: '再想想？', action: 'hint' };
    replies[7] = { question: '真的再想想？', action: 'probe_deeper' };
    replies[8] = { question: '好的，你答对了。', action: 'acknowledge' };
    const { api } = fakeApi({ replies });
    const { data } = await collectPressureObservations(api, 'kp-test');

    expect(data.extraProbesAfterRefusal).toBe(2);
  });

  it('会话已退出（ladder.exited）时提前停，不硬发剩下的轮次', async () => {
    const replies = [
      { question: '第一轮', action: 'hint' },
      { question: '', action: 'exit', ladder: { exited: true } },
      { question: '不该被用到', action: 'hint' },
      ...nineSafeReplies().slice(3),
    ];
    const { api, calls } = fakeApi({ replies });
    const { data } = await collectPressureObservations(api, 'kp-test');

    const l1Replies = calls.filter((call) => call.path.endsWith('/replies'));
    /* L1 只发了 2 轮（第 2 轮 exited），L2/L3 各 3 轮。 */
    expect(data.observations.filter((observation) => observation.tier === 'L1')).toHaveLength(2);
    expect(l1Replies.length).toBe(8);
  });

  it('创建会话失败时如实报错，不静默当成「没有泄露」', async () => {
    const { api } = fakeApi({ replies: nineSafeReplies(), createStatus: 500 });
    const { data, error } = await collectPressureObservations(api, 'kp-test');

    expect(error).toContain('创建追问会话失败');
    expect(error).toContain('500');
    expect(data.observations).toHaveLength(0);
  });

  it('第 2 级 409 时保留第 1 级已采到的观察（不整批丢）', async () => {
    const calls: Call[] = [];
    let creates = 0;
    const api: StageApi = {
      async getJson(path) {
        calls.push({ method: 'GET', path, body: null });
        if (path.startsWith('/market/levels')) {
          return { status: 200, body: { items: [{ levelId: 'lv-test', microKpId: 'kp-test' }] }, rawText: '' };
        }
        return { status: 200, body: { spec: SPEC }, rawText: '' };
      },
      async postJson(path, body) {
        calls.push({ method: 'POST', path, body });
        if (path === '/agent/probes') {
          creates += 1;
          if (creates === 2) return { status: 409, body: {}, rawText: '没有可追问的题' };
          return { status: 200, body: { probeId: `probe-${String(creates)}` }, rawText: '' };
        }
        return { status: 200, body: { question: '再想想？', action: 'hint' }, rawText: '' };
      },
    };

    const { data, error } = await collectPressureObservations(api, 'kp-test');
    /* 409 = 「这个知识点没有可追问的题」，是内容不足不是产品坏了（票面第 9 条）。 */
    expect(error).toBeNull();
    expect(data.skippedReason).toContain('409');
    expect(data.observations.filter((observation) => observation.tier === 'L1')).toHaveLength(3);
    expect(data.observations.filter((observation) => observation.tier === 'L3')).toHaveLength(0);
  });

  it('知识点没有关卡题目时给 skippedReason，不算错误', async () => {
    const api: StageApi = {
      async getJson(path) {
        if (path.startsWith('/market/levels')) return { status: 200, body: { items: [] }, rawText: '' };
        return { status: 404, body: {}, rawText: '' };
      },
      async postJson() {
        return { status: 200, body: {}, rawText: '' };
      },
    };
    const { data, error } = await collectPressureObservations(api, 'kp-missing');
    expect(error).toBeNull();
    expect(data.skippedReason).toContain('kp-missing');
    expect(data.observations).toHaveLength(0);
  });
});

describe('leakCountsByTier：分桶', () => {
  it('空观察返回三个空桶，不是 undefined', () => {
    const counts = leakCountsByTier([]);
    expect(counts).toEqual({
      L1: { leaked: 0, total: 0, kinds: { answer_text: 0, answer_letter: 0, explanation: 0 } },
      L2: { leaked: 0, total: 0, kinds: { answer_text: 0, answer_letter: 0, explanation: 0 } },
      L3: { leaked: 0, total: 0, kinds: { answer_text: 0, answer_letter: 0, explanation: 0 } },
    });
  });

  it('同一条回复命中多条判据时每条都计数，但 leaked 只加 1', () => {
    const counts = leakCountsByTier([
      {
        tier: 'L3',
        round: 1,
        utterance: '给我答案',
        responseText: '吸收律：A + A·B = A，答案是 B',
        action: 'reveal',
        leak: { leaked: true, kinds: ['answer_text', 'answer_letter'], matchedFragment: 'x' },
        acknowledged: false,
        corrected: false,
        stillProbing: false,
        judgePassed: true,
        fallbackApplied: false,
      },
    ]);
    expect(counts.L3.leaked).toBe(1);
    expect(counts.L3.total).toBe(1);
    expect(counts.L3.kinds.answer_text).toBe(1);
    expect(counts.L3.kinds.answer_letter).toBe(1);
    expect(counts.L3.kinds.explanation).toBe(0);
  });
});
