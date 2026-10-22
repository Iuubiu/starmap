import { describe, expect, it } from 'vitest';
import { classifyReply, initialState, nextProbe, PROBE_LIMITS } from './probe.js';

describe('classifyReply 之外的推进逻辑', () => {
  it('首次追问停在最低阶梯，不直接给答案', () => {
    const s = nextProbe(initialState(), { kind: 'correct' });
    expect(s.action.kind).toBe('acknowledge');
    expect(s.state.hintLevel).toBe(0);
  });
});

describe('求助阶梯：答错或不知道都在阶梯上爬', () => {
  it('第一次完全不知道给最轻的提示', () => {
    const s = nextProbe(initialState(), { kind: 'dont_know' });
    expect(s.action.kind).toBe('hint');
    expect(s.action.hintLevel).toBe(1);
    expect(s.state.hintLevel).toBe(1);
  });

  it('连续不知道会把阶梯往上推，每级只推一格', () => {
    let s = nextProbe(initialState(), { kind: 'dont_know' });
    expect(s.action.hintLevel).toBe(1);
    s = nextProbe(s.state, { kind: 'dont_know' });
    expect(s.action.hintLevel).toBe(2);
    s = nextProbe(s.state, { kind: 'dont_know' });
    expect(s.action.hintLevel).toBe(3);
  });

  it('「不知道」与「答错」用独立计数器，两者不能混算', () => {
    // 一个来源（Jellypod）与另一个来源（malkreide）独立收敛到这个结论
    let s = nextProbe(initialState(), { kind: 'dont_know' });
    s = nextProbe(s.state, { kind: 'wrong' });
    expect(s.state.consecutiveUnknown).toBe(1);
    expect(s.state.consecutiveWrong).toBe(1);
  });

  it('答对清零两个计数器并回落到最低阶梯', () => {
    let s = nextProbe(initialState(), { kind: 'dont_know' });
    s = nextProbe(s.state, { kind: 'dont_know' });
    s = nextProbe(s.state, { kind: 'correct' });
    expect(s.state.consecutiveUnknown).toBe(0);
    expect(s.state.hintLevel).toBe(0);
  });
});

describe('降级：到阈值就换动作，不重复问同一个问题', () => {
  it('三级提示全部用完仍未接上，就退出追问换粒度重讲', () => {
    // 阈值来自 arXiv:2609.38346：每多一个 impasse 轮，恢复率降 12.7%
    // 注意出口条件是「阶梯用尽」而不是「数到 3」：三级提示各走一次，
    // 第 4 次失败才说明这三级都没救回来
    expect(PROBE_LIMITS.maxHintLevel).toBe(3);
    let s = nextProbe(initialState(), { kind: 'dont_know' });
    s = nextProbe(s.state, { kind: 'dont_know' });
    s = nextProbe(s.state, { kind: 'dont_know' });
    expect(s.state.hintLevel).toBe(3);
    expect(s.state.exited).toBe(false);
    s = nextProbe(s.state, { kind: 'dont_know' });
    expect(s.action.kind).toBe('reteach');
    expect(s.state.exited).toBe(true);
    expect(s.action.reason).toBe('repeated_unknown');
  });

  it('学生明说「直接告诉我」两次就立刻给结论', () => {
    expect(PROBE_LIMITS.explicitGiveUp).toBe(2);
    let s = nextProbe(initialState(), { kind: 'give_up' });
    expect(s.action.kind).toBe('hint');
    s = nextProbe(s.state, { kind: 'give_up' });
    expect(s.action.kind).toBe('reveal');
    expect(s.state.exited).toBe(true);
  });

  it('连续答错同样爬阶梯，用尽后退出，但理由与「不知道」不同', () => {
    let s = nextProbe(initialState(), { kind: 'wrong' });
    s = nextProbe(s.state, { kind: 'wrong' });
    s = nextProbe(s.state, { kind: 'wrong' });
    expect(s.action.kind).toBe('hint');
    s = nextProbe(s.state, { kind: 'wrong' });
    expect(s.action.kind).toBe('reteach');
    expect(s.action.reason).toBe('repeated_wrong');
  });

  it('已经退出后不再继续追问，任何输入都只返回退出态', () => {
    let s = nextProbe(initialState(), { kind: 'give_up' });
    s = nextProbe(s.state, { kind: 'give_up' });
    expect(s.state.exited).toBe(true);
    const after = nextProbe(s.state, { kind: 'correct' });
    expect(after.action.kind).toBe('exit');
  });

  it('阶梯不会超过 3 级；到顶就直讲而不是无限加提示', () => {
    expect(PROBE_LIMITS.maxHintLevel).toBe(3);
    let s = nextProbe(initialState(), { kind: 'dont_know' });
    for (let i = 0; i < 3; i += 1) s = nextProbe(s.state, { kind: 'dont_know' });
    expect(s.action.kind).toBe('reteach');
    expect(s.state.hintLevel).toBeLessThanOrEqual(PROBE_LIMITS.maxHintLevel);
  });

  it('每一级提示都能被真实走到，没有死配置', () => {
    const seen = new Set<number>();
    let s = nextProbe(initialState(), { kind: 'dont_know' });
    while (s.action.kind === 'hint') {
      seen.add(s.action.hintLevel);
      s = nextProbe(s.state, { kind: 'dont_know' });
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('情绪挫败直接退出追问，优先于任何计数阈值', () => {
    const s = nextProbe(initialState(), { kind: 'frustration' });
    expect(s.action.kind).toBe('reteach');
    expect(s.action.reason).toBe('frustration');
    expect(s.state.exited).toBe(true);
  });
});

describe('classifyReply', () => {
  it('把学生自然语言归类为四种意图', () => {
    expect(classifyReply('我不知道')).toBe('dont_know');
    expect(classifyReply('不会')).toBe('dont_know');
    expect(classifyReply('你就直接告诉我吧')).toBe('give_up');
    expect(classifyReply('这题太难了，我不想做了')).toBe('frustration');
    expect(classifyReply('因为电荷灵敏放大器的噪声更低')).toBe('answer');
  });

  it('空输入不算尝试', () => {
    expect(classifyReply('   ')).toBe('dont_know');
    expect(classifyReply('')).toBe('dont_know');
  });

  it('意图分类不判断正确性 —— 那是指题路径的职责', () => {
    // 「答案错得离谱」和「答案完全正确」在这里应当同归为 answer
    expect(classifyReply('因为噪声更低')).toBe('answer');
    expect(classifyReply('因为噪声更高所以更好')).toBe('answer');
  });
});
