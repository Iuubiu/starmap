/**
 * 苏格拉底追问状态机。纯函数，无 IO，无 LLM（ADR-0003）。
 *
 * 为什么不用提示词实现：arXiv:2608.12292 实测显示，一个能力很强的模型在
 * 被沮丧的学生反复施压时无法可靠地憋住答案。对策是「非 LLM 的策略内核
 * 读取可信学习者状态，每轮设一个上限」。这个文件就是那个内核。
 *
 * 为什么不用 Mastra Workflow：每条分支路径都要能被穷举测试，而 Workflow
 * 的 step 生命周期随版本变动。详见 ADR-0003。
 */

/** 学生回复的六分类。LLM 只做分类，不做决策。 */
export type ReplyKind = 'correct' | 'partial' | 'wrong' | 'dont_know' | 'give_up' | 'frustration';

export interface ProbeState {
  hintLevel: number;
  consecutiveUnknown: number;
  consecutiveWrong: number;
  consecutiveGiveUp: number;
  /** 已退出追问；之后只等待学习者主动继续 */
  exited: boolean;
}

export type ProbeAction =
  | { kind: 'acknowledge'; message: string }
  | { kind: 'hint'; hintLevel: number; message: string }
  | { kind: 'probe_deeper'; message: string }
  | { kind: 'reteach'; reason: 'repeated_unknown' | 'repeated_wrong' | 'frustration'; message: string }
  | { kind: 'reveal'; message: string }
  | { kind: 'exit'; message: string };

export interface ProbeTransition {
  state: ProbeState;
  action: ProbeAction;
}

/**
 * 阈值有实验依据（arXiv:2609.38346）：首次追问失败后，重复同一个问题
 * 恢复率 28.1%，改为针对错误本身则 39.8%。所以到阈值必须换动作。
 *
 * 阶梯共 3 级。退出条件不是「数到 3」，而是「阶梯用尽且再一次失败」——
 * 否则最后一级提示永远走不到，是死配置（这个坑我第一版就踩了）。
 */
export const PROBE_LIMITS = {
  maxHintLevel: 3,
  explicitGiveUp: 2,
} as const;

export function initialState(): ProbeState {
  return {
    hintLevel: 0,
    consecutiveUnknown: 0,
    consecutiveWrong: 0,
    consecutiveGiveUp: 0,
    exited: false,
  };
}

function resetCounters(state: ProbeState): ProbeState {
  return {
    ...state,
    hintLevel: 0,
    consecutiveUnknown: 0,
    consecutiveWrong: 0,
    consecutiveGiveUp: 0,
  };
}

export function nextProbe(state: ProbeState, reply: { kind: ReplyKind }): ProbeTransition {
  if (state.exited) {
    return {
      state,
      action: { kind: 'exit', message: '本轮追问已结束，等待你继续。' },
    };
  }

  switch (reply.kind) {
    case 'correct': {
      return {
        state: resetCounters(state),
        action: { kind: 'acknowledge', message: '对。这一步的思路是通的。' },
      };
    }

    case 'partial': {
      // 部分正确：不升阶梯也不降级，针对缺口再问一层
      return {
        state: { ...state, consecutiveUnknown: 0, consecutiveWrong: 0, consecutiveGiveUp: 0 },
        action: { kind: 'probe_deeper', message: '方向对了一半，再往下想一层：这个结论在哪一步用到？' },
      };
    }

    case 'wrong': {
      const consecutiveWrong = state.consecutiveWrong + 1;
      // 阶梯用尽才换讲法：先给完 3 级提示，再失败一次才重讲
      if (state.hintLevel >= PROBE_LIMITS.maxHintLevel) {
        return {
          state: { ...state, consecutiveWrong, exited: true },
          action: {
            kind: 'reteach',
            reason: 'repeated_wrong',
            message: '提示都用完了还没接上，我换一个更小的粒度重新讲一遍。',
          },
        };
      }
      const hintLevel = state.hintLevel + 1;
      return {
        state: { ...state, consecutiveWrong, hintLevel },
        action: { kind: 'hint', hintLevel, message: `提示 ${hintLevel}：先看这一步的前提条件是否成立。` },
      };
    }

    case 'dont_know': {
      const consecutiveUnknown = state.consecutiveUnknown + 1;
      if (state.hintLevel >= PROBE_LIMITS.maxHintLevel) {
        return {
          state: { ...state, consecutiveUnknown, exited: true },
          action: {
            kind: 'reteach',
            reason: 'repeated_unknown',
            message: '连续几次都没接上，说明这个粒度的讲解还不够，我重讲一遍。',
          },
        };
      }
      const hintLevel = state.hintLevel + 1;
      return {
        state: { ...state, consecutiveUnknown, hintLevel },
        action: { kind: 'hint', hintLevel, message: `提示 ${hintLevel}：从这个概念的输入输出关系入手。` },
      };
    }

    case 'give_up': {
      const consecutiveGiveUp = state.consecutiveGiveUp + 1;
      if (consecutiveGiveUp >= PROBE_LIMITS.explicitGiveUp) {
        return {
          state: { ...state, consecutiveGiveUp, exited: true },
          action: { kind: 'reveal', message: '好，直接说结论，然后我们回看为什么。' },
        };
      }
      const hintLevel = Math.min(state.hintLevel + 1, PROBE_LIMITS.maxHintLevel);
      return {
        state: { ...state, consecutiveGiveUp, hintLevel },
        action: { kind: 'hint', hintLevel, message: '再给一次提示，还接不上就直说。' },
      };
    }

    case 'frustration': {
      // 情绪优先于任何计数阈值
      return {
        state: { ...state, exited: true },
        action: {
          kind: 'reteach',
          reason: 'frustration',
          message: '先停一下。这个点我们换一种讲法，从你能理解的地方重新开始。',
        },
      };
    }
  }
}

const DONT_KNOW_PATTERNS = [
  /^(我)?(也)?(还)?不?知道(了|啊|呀)?$/,
  /^(我)?(也)?不会(做|啊|呀)?$/,
  /^(我)?不确定$/,
  /^(我)?没(有)?思路$/,
  /^(不)?清楚$/,
  /^\s*$/,
];
const GIVE_UP_PATTERNS = [/直接告诉/, /告诉我答案/, /给?我答案/, /直接给/, /看答案/, /不会做你讲/];
const FRUSTRATION_PATTERNS = [/太难/, /不想做/, /烦/, /放弃/, /受不了/, /换个/, /没意思/];

/**
 * 回复的**意图**分类，不含正确性判断。
 * 正确性由题目答案比对得出（答题路径）或由 LLM 判定（追问路径），
 * 两者都不能靠关键词猜——所以这个函数只回答「学生想干什么」。
 */
export type ReplyIntent = 'answer' | 'dont_know' | 'give_up' | 'frustration';

/**
 * 关键词意图分类器。这是**兜底**路径，用于没有 LLM 或 LLM 分类失败时。
 * 生产路径由 LlmPort 的 structuredOutput 返回意图 + 正确性两个字段。
 */
export function classifyReply(text: string): ReplyIntent {
  const normalized = text.trim();
  if (normalized.length === 0) return 'dont_know';

  if (FRUSTRATION_PATTERNS.some((p) => p.test(normalized))) return 'frustration';
  if (GIVE_UP_PATTERNS.some((p) => p.test(normalized))) return 'give_up';
  if (DONT_KNOW_PATTERNS.some((p) => p.test(normalized))) return 'dont_know';
  return 'answer';
}
