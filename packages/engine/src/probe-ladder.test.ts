import { describe, expect, it } from 'vitest';
import {
  initialLadderState,
  LADDER_LEVELS,
  LADDER_THRESHOLDS,
  ladderCap,
  nextLadder,
  TIER_LADDER,
} from './probe-ladder.js';

describe('求助阶梯的上限由非 LLM 策略核心决定', () => {
  it('P1 最多到 3 级、P2 到 4 级、P3 到 5 级', () => {
    expect(ladderCap({ tier: 'P1' })).toBe(3);
    expect(ladderCap({ tier: 'P2' })).toBe(4);
    expect(ladderCap({ tier: 'P3' })).toBe(5);
  });

  it('五级主题是固定的，不随模型输出变化', () => {
    expect(LADDER_LEVELS).toHaveLength(5);
    expect(LADDER_LEVELS.map((l) => l.level)).toEqual([1, 2, 3, 4, 5]);
    expect(LADDER_LEVELS[0]?.topic).toBe('概念辨认与量纲单位');
    expect(LADDER_LEVELS[4]?.topic).toBe('设计权衡');
  });

  it('每级的骨架问句恰好一个问号，且以问号结尾', () => {
    // 这不是文案洁癖：safeQuestion 会把它原样拼给学习者，它同时是
    // 「模型措辞越界时的兜底」和「每轮只问一个问题」在非 LLM 路径上的保证。
    for (const level of LADDER_LEVELS) {
      const marks = level.ask.match(/[?？]/g) ?? [];
      expect(marks, `第 ${level.level} 级的 ask 问号数量不对：${level.ask}`).toHaveLength(1);
      expect(level.ask.trim().endsWith('？'), `第 ${level.level} 级的 ask 不以问号结尾：${level.ask}`).toBe(
        true,
      );
    }
  });

  it('P1 学习者即使连续失败也拿不到第 4 级提示', () => {
    let state = initialLadderState('P1');
    const seen: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const t = nextLadder(state, { kind: 'dont_know' });
      state = t.state;
      if (t.action.kind === 'hint') seen.push(t.action.level);
      if (t.action.kind === 'reteach') break;
    }
    expect(Math.max(...seen)).toBeLessThanOrEqual(3);
    expect(state.maxLevelUsed).toBeLessThanOrEqual(3);
  });

  it('每一轮只推进一格，不跳级', () => {
    let state = initialLadderState('P3');
    const t1 = nextLadder(state, { kind: 'dont_know' });
    expect(t1.action.kind).toBe('hint');
    if (t1.action.kind === 'hint') expect(t1.action.level).toBe(3); // P3 起步就在第 3 级
    state = t1.state;

    const t2 = nextLadder(state, { kind: 'dont_know' });
    if (t2.action.kind === 'hint') expect(t2.action.level).toBe(4);
  });

  it('答对清零计数器并回到起点', () => {
    let state = initialLadderState('P2');
    state = nextLadder(state, { kind: 'wrong' }).state;
    expect(state.consecutiveWrong).toBe(1);
    state = nextLadder(state, { kind: 'wrong' }).state;
    expect(state.consecutiveWrong).toBe(2);

    const t = nextLadder(state, { kind: 'correct' });
    expect(t.action.kind).toBe('acknowledge');
    expect(t.state.consecutiveWrong).toBe(0);
    expect(t.state.noProgress).toBe(0);
  });
});

describe('两个计数器阈值不同：不知道比答错更早降级', () => {
  it('连续两次「不知道」就换更小粒度', () => {
    let state = initialLadderState('P1');
    state = nextLadder(state, { kind: 'dont_know' }).state;
    expect(state.exited).toBe(false);

    const t = nextLadder(state, { kind: 'dont_know' });
    expect(t.action.kind).toBe('reteach');
    if (t.action.kind === 'reteach') expect(t.action.reason).toBe('repeated_unknown');
    expect(t.state.exited).toBe(true);
  });

  it('「答错」要连续三次才降级（阈值与不知道不同）', () => {
    expect(LADDER_THRESHOLDS.unknownBeforeReteach).toBe(2);
    expect(LADDER_THRESHOLDS.wrongBeforeReteach).toBe(3);

    let state = initialLadderState('P1');
    state = nextLadder(state, { kind: 'wrong' }).state;
    state = nextLadder(state, { kind: 'wrong' }).state;
    expect(state.exited).toBe(false);

    const t = nextLadder(state, { kind: 'wrong' });
    expect(t.action.kind).toBe('reteach');
    if (t.action.kind === 'reteach') expect(t.action.reason).toBe('repeated_wrong');
  });

  it('两个计数器互不干扰：交替答错与不知道时各自计数', () => {
    let state = initialLadderState('P1');
    state = nextLadder(state, { kind: 'dont_know' }).state;
    expect(state.consecutiveUnknown).toBe(1);
    expect(state.consecutiveWrong).toBe(0);

    state = nextLadder(state, { kind: 'wrong' }).state;
    // 答错把 consecutiveUnknown 清零，但 consecutiveWrong 从 0 起算
    expect(state.consecutiveUnknown).toBe(0);
    expect(state.consecutiveWrong).toBe(1);
    expect(state.exited).toBe(false);
  });

  it('连续三轮无进展即退出追问（即使两个计数器都没到阈值）', () => {
    let state = initialLadderState('P3');
    // 交替 different 类型，两个独立计数器都到不了阈值，但 noProgress 会
    state = nextLadder(state, { kind: 'wrong' }).state;
    state = nextLadder(state, { kind: 'dont_know' }).state;
    expect(state.exited).toBe(false);

    const t = nextLadder(state, { kind: 'wrong' });
    expect(t.action.kind).toBe('reteach');
    if (t.action.kind === 'reteach') expect(t.action.reason).toBe('no_progress');
  });
});

describe('退出路径', () => {
  it('放弃 → 直接给结论（reveal）', () => {
    const t = nextLadder(initialLadderState('P2'), { kind: 'give_up' });
    expect(t.action.kind).toBe('reveal');
    expect(t.state.exited).toBe(true);
  });

  it('情绪信号优先于任何计数阈值', () => {
    const t = nextLadder(initialLadderState('P3'), { kind: 'frustration' });
    expect(t.action.kind).toBe('reteach');
    if (t.action.kind === 'reteach') expect(t.action.reason).toBe('frustration');
  });

  it('已经退出后再来一轮，保持退出且不产生新提示', () => {
    const exited = nextLadder(initialLadderState('P1'), { kind: 'give_up' }).state;
    const t = nextLadder(exited, { kind: 'dont_know' });
    expect(t.action.kind).toBe('exit');
    expect(t.state.exited).toBe(true);
    expect(t.state.level).toBe(exited.level);
  });

  it('阶梯用尽后换动作而不是无限重复同一级提示', () => {
    let state = initialLadderState('P1');
    for (let i = 0; i < 10 && !state.exited; i += 1) {
      state = nextLadder(state, { kind: 'partial' }).state;
      if (state.exited) break;
    }
    // partial 不退出，只会停在 cap 上；确认没有越界
    expect(state.maxLevelUsed).toBeLessThanOrEqual(3);

    // 用 wrong 推到退出
    let s2 = initialLadderState('P1');
    const actions: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const t = nextLadder(s2, { kind: 'wrong' });
      actions.push(t.action.kind);
      s2 = t.state;
      if (s2.exited) break;
    }
    expect(actions).toContain('reteach');
  });
});

describe('不重复同一个问题', () => {
  it('追问文本记录在 state 里且不重复入列', () => {
    let state = initialLadderState('P1');
    state = nextLadder(state, { kind: 'partial' }).state;
    const t = nextLadder(state, { kind: 'partial' });
    const all = t.state.askedQuestions;
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('档位起步位置', () => {
  it('P1 从第 1 级起步，P2 从第 2 级，P3 从第 3 级', () => {
    expect(TIER_LADDER.P1.start).toBe(1);
    expect(TIER_LADDER.P2.start).toBe(2);
    expect(TIER_LADDER.P3.start).toBe(3);

    const t = nextLadder(initialLadderState('P2'), { kind: 'dont_know' });
    if (t.action.kind === 'hint') expect(t.action.level).toBe(2);
  });
});
