/**
 * 5 级求助阶梯的**非 LLM 策略核心**（票 10）。
 *
 * 与 `probe.ts` 的分工，必须说清，否则两条状态机会互相打架：
 *
 * - `probe.ts` 是**追问轮序列**的状态机（3 级提示、计数器、退出条件），
 *   它已经在票 04 之前就存在并有测试，语义不改。
 * - 本文件是**求助阶梯**的策略核心：5 级、每级的主题固定，并且「本轮最多
 *   允许用到第几级」由可信学习者状态（水平档 P1/P2/P3 + 已用提示数 +
 *   连续失败数）决定，**模型无权越过**。
 *
 * 为什么必须是非 LLM：一篇实测（arXiv:2608.12292）显示，能力越强的模型在
 * 被反复施压时越容易把答案漏出来。把上限交给模型判断，等于把「不给答案」
 * 交给最想给答案的那一方。所以这里是纯函数，只读非 LLM 传入的学习者状态。
 *
 * 纯函数、无 IO、无框架依赖（engine 包的硬约束）。
 */

/** 阶梯的五级主题。与 spec §6 的措辞逐字对应。 */
export const LADDER_LEVELS = [
  { level: 1, topic: '概念辨认与量纲单位', ask: '先确认这一步涉及哪个物理量、单位是什么。' },
  { level: 2, topic: '公式选择与适用条件', ask: '这一步该用哪个关系式？它的适用条件在这里成立吗？' },
  { level: 3, topic: '近似与误差合理性', ask: '这个近似在本条件下合理吗？误差量级大概是多少？' },
  { level: 4, topic: '边界情形与失效模式', ask: '参数推到边界时会发生什么？哪种情况下这个方法失效？' },
  { level: 5, topic: '设计权衡', ask: '如果要在分辨率与计数率之间取舍，你会怎么定？' },
] as const;

export type LadderLevel = 1 | 2 | 3 | 4 | 5;

/** 水平档 → 阶梯起始级与上限（spec §5 的表格） */
export const TIER_LADDER: Record<'P1' | 'P2' | 'P3', { start: LadderLevel; cap: LadderLevel }> = {
  P1: { start: 1, cap: 3 },
  P2: { start: 2, cap: 4 },
  P3: { start: 3, cap: 5 },
};

/**
 * 两个计数器阈值不同（票 10 的硬要求）。
 *
 * 「不知道」比「答错」更早触发降级：不知道说明当前**粒度**不对，再给同层
 * 提示只是浪费轮次；答错说明粒度可能对、只是没算对，多给一级更合理。
 */
export const LADDER_THRESHOLDS = {
  /** 连续「不知道」到几次就降粒度重讲 */
  unknownBeforeReteach: 2,
  /** 连续「答错」到几次就降粒度重讲 */
  wrongBeforeReteach: 3,
  /** 无论哪种，同一轮序列内连续 3 轮无进展即退出追问（spec 表 3 的空转上限） */
  noProgressExit: 3,
} as const;

export type LadderReplyKind = 'correct' | 'partial' | 'wrong' | 'dont_know' | 'give_up' | 'frustration';

export interface LadderPolicy {
  tier: 'P1' | 'P2' | 'P3';
}

export interface LadderState {
  tier: 'P1' | 'P2' | 'P3';
  /** 当前用到第几级；0 表示还没给过提示 */
  level: number;
  /** 本轮序列里给过的最大级别 */
  maxLevelUsed: number;
  consecutiveUnknown: number;
  consecutiveWrong: number;
  /** 连续无进展轮数（不知道 + 答错 + 放弃都算，答对清零） */
  noProgress: number;
  exits: number;
  exited: boolean;
  /** 上一次发出的动作，用来保证「降级后换动作」而不是重复同一个问题 */
  lastAction: string | null;
  /** 已经问过的问题文本（判重用，规格要「不重复同一个问题」） */
  askedQuestions: string[];
}

export type LadderAction =
  | { kind: 'acknowledge'; message: string }
  | { kind: 'hint'; level: LadderLevel; topic: string; message: string }
  | { kind: 'reteach'; reason: 'repeated_unknown' | 'repeated_wrong' | 'no_progress' | 'frustration'; message: string }
  | { kind: 'reveal'; message: string }
  | { kind: 'exit'; message: string };

export interface LadderTransition {
  state: LadderState;
  action: LadderAction;
  /** 本轮允许到达的最高级——由策略核心决定，模型无权越过 */
  cap: LadderLevel;
}

export function initialLadderState(tier: 'P1' | 'P2' | 'P3' = 'P1'): LadderState {
  return {
    tier,
    level: 0,
    maxLevelUsed: 0,
    consecutiveUnknown: 0,
    consecutiveWrong: 0,
    noProgress: 0,
    exits: 0,
    exited: false,
    lastAction: null,
    askedQuestions: [],
  };
}

/** 本轮上限：档位上限，且不超过 5。这是唯一的权威来源。 */
export function ladderCap(policy: LadderPolicy): LadderLevel {
  return TIER_LADDER[policy.tier].cap;
}

/**
 * 推进一轮。
 *
 * 三条不能破的约束（票 10 的验收项，逐条对应）：
 * 1. 每轮只推进一格阶梯，且永远不超过 `ladderCap`；
 * 2. 「不知道」与「答错」分别计数，阈值不同（LADDER_THRESHOLDS）；
 * 3. 降级后**换动作**：`reteach` 而不是再问一遍同一级问题。
 */
export function nextLadder(
  state: LadderState,
  reply: { kind: LadderReplyKind },
  policy?: LadderPolicy,
): LadderTransition {
  const effectivePolicy: LadderPolicy = policy ?? { tier: state.tier };
  const cap = ladderCap(effectivePolicy);
  const tierStart = TIER_LADDER[effectivePolicy.tier].start;

  if (state.exited) {
    return {
      state,
      action: { kind: 'exit', message: '本轮追问已结束。要不要换一个更小的知识点继续？' },
      cap,
    };
  }

  switch (reply.kind) {
    case 'correct': {
      return {
        state: {
          ...state,
          level: 0,
          maxLevelUsed: state.maxLevelUsed,
          consecutiveUnknown: 0,
          consecutiveWrong: 0,
          noProgress: 0,
          lastAction: 'acknowledge',
          askedQuestions: [],
        },
        action: { kind: 'acknowledge', message: '对。这一步的推理是成立的，我们往下走。' },
        cap,
      };
    }

    case 'partial': {
      // 部分正确：不升阶梯，但**换一个问题**——重复原问题会让学习者以为没听见
      const level = clampLevel(Math.max(state.level, tierStart), cap);
      const message = `方向对了一半。把缺的那一步补上：${LADDER_LEVELS[level - 1]?.ask ?? ''}`;
      return {
        state: {
          ...state,
          level,
          maxLevelUsed: Math.max(state.maxLevelUsed, level),
          consecutiveUnknown: 0,
          consecutiveWrong: 0,
          noProgress: state.noProgress,
          lastAction: 'partial_probe',
          askedQuestions: pushOnce(state.askedQuestions, message),
        },
        action: { kind: 'hint', level: level as LadderLevel, topic: LADDER_LEVELS[level - 1]?.topic ?? '', message },
        cap,
      };
    }

    case 'wrong':
    case 'dont_know': {
      const isUnknown = reply.kind === 'dont_know';
      // 「连续」的含义：另一类回复会打断这一类的连续计数。两个计数器彼此
      // **独立**（各自有阈值），但不是「互不相关」——答错说明学生知道要答
      // 什么、只是错了，它确实终止了「连续不知道」这条链。
      const consecutiveUnknown = isUnknown ? state.consecutiveUnknown + 1 : 0;
      const consecutiveWrong = isUnknown ? 0 : state.consecutiveWrong + 1;
      const noProgress = state.noProgress + 1;

      // 判定顺序有讲究：**先看具体计数器，再看空转上限**。
      // 两者在「连续三次答错」这一轮会同时达标（wrongBeforeReteach 与
      // noProgressExit 都是 3）。此时应当报 `repeated_wrong`——它告诉学习者
      // 「同一个地方卡住了」，比笼统的 no_progress 更有指导性。
      // `no_progress` 留给「两种失败交替出现、哪条都没到阈值」的情形。
      if (isUnknown && consecutiveUnknown >= LADDER_THRESHOLDS.unknownBeforeReteach) {
        return {
          state: {
            ...state,
            consecutiveUnknown,
            consecutiveWrong,
            noProgress,
            exited: true,
            exits: state.exits + 1,
            lastAction: 'reteach:repeated_unknown',
          },
          action: {
            kind: 'reteach',
            reason: 'repeated_unknown',
            message: '连着两次都是「不知道」，问题问得太大。我把它拆成一个更小的步骤再问。',
          },
          cap,
        };
      }

      if (!isUnknown && consecutiveWrong >= LADDER_THRESHOLDS.wrongBeforeReteach) {
        return {
          state: {
            ...state,
            consecutiveUnknown,
            consecutiveWrong,
            noProgress,
            exited: true,
            exits: state.exits + 1,
            lastAction: 'reteach:repeated_wrong',
          },
          action: {
            kind: 'reteach',
            reason: 'repeated_wrong',
            message: '同一个地方错了三次。先放下这道题，我换一个更基础的讲法。',
          },
          cap,
        };
      }

      // 空转上限：连续 3 轮没有进展就退出追问，不论两个计数器长什么样
      if (noProgress >= LADDER_THRESHOLDS.noProgressExit) {
        return {
          state: {
            ...state,
            consecutiveUnknown,
            consecutiveWrong,
            noProgress,
            exited: true,
            exits: state.exits + 1,
            lastAction: 'reteach:no_progress',
          },
          action: {
            kind: 'reteach',
            reason: 'no_progress',
            message: '连续三轮都没接上，说明这个粒度不合适。换更小的粒度重讲一遍。',
          },
          cap,
        };
      }

      // 正常推进一格；到顶后不再加码，直接换动作（不是无限提示）
      const nextLevel = state.level + 1;
      if (nextLevel > cap) {
        return {
          state: {
            ...state,
            consecutiveUnknown,
            consecutiveWrong,
            noProgress,
            exited: true,
            exits: state.exits + 1,
            lastAction: 'reteach:ladder_exhausted',
          },
          action: {
            kind: 'reteach',
            reason: isUnknown ? 'repeated_unknown' : 'repeated_wrong',
            message: `这一档的提示已经用完了（最多 ${cap} 级）。换成更小的粒度重讲。`,
          },
          cap,
        };
      }

      const level = clampLevel(Math.max(nextLevel, tierStart), cap);
      const entry = LADDER_LEVELS[level - 1];
      const message = `提示 ${level}/${cap}（${entry?.topic ?? ''}）：${entry?.ask ?? ''}`;
      return {
        state: {
          ...state,
          level,
          maxLevelUsed: Math.max(state.maxLevelUsed, level),
          consecutiveUnknown,
          consecutiveWrong,
          noProgress,
          lastAction: `hint:${level}`,
          askedQuestions: pushOnce(state.askedQuestions, message),
        },
        action: { kind: 'hint', level: level as LadderLevel, topic: entry?.topic ?? '', message },
        cap,
      };
    }

    case 'give_up': {
      return {
        state: { ...state, exited: true, exits: state.exits + 1, lastAction: 'reveal' },
        action: { kind: 'reveal', message: '好，我直接说结论，然后我们回看它为什么成立。' },
        cap,
      };
    }

    case 'frustration': {
      // 情绪优先于任何计数阈值
      return {
        state: { ...state, exited: true, exits: state.exits + 1, lastAction: 'reteach:frustration' },
        action: {
          kind: 'reteach',
          reason: 'frustration',
          message: '先停一下。这个点我们换一种讲法，从你能接住的地方重新开始。',
        },
        cap,
      };
    }
  }
}

function clampLevel(level: number, cap: number): number {
  return Math.max(1, Math.min(level, cap));
}

function pushOnce(list: string[], value: string): string[] {
  return list.includes(value) ? list : [...list, value];
}
