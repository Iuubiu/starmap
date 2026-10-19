/**
 * 掌握度内核。纯函数，无 IO。
 *
 * 双字段设计（ADR-0004 + D2）：
 * - `achieved` 不衰减，管解锁；只用「是否曾经达到过掌握」的单调事实。
 * - `current` 会衰减，管推荐与检索门控；半衰期按题目类型不同。
 */

export interface BktParams {
  /** P(L0)：起步掌握概率 */
  prior: number;
  /** 学习转移率：每次机会后的掌握概率增量 */
  learn: number;
  /** 失误率：已掌握仍答错 */
  slip: number;
  /** 猜测率：未掌握但答对。单选题应设为 1/选项数 */
  guess: number;
}

/**
 * 参数取自 @demystify/play-learn 的 textbook 档与 OATutor 的经验值区间。
 * guess 默认 0.25 对应四选一；实际使用时由引擎按选项数覆盖。
 */
export const DEFAULT_BKT: BktParams = {
  prior: 0.25,
  learn: 0.15,
  slip: 0.1,
  guess: 0.25,
};

/** 展示掌握需要的最小作答次数与最小变式数（spec 表 3） */
export const MASTERY_MIN_ATTEMPTS = 8;
export const MASTERY_MIN_VARIANTS = 3;
/** P(known) 阈值 */
export const MASTERY_THRESHOLD = 0.95;

export interface MasteryKernelState {
  pKnown: number;
  attempts: number;
}

/**
 * 概率被夹在这个开区间里，**不能取 0 或 1**。
 *
 * 属性测试发现的真问题：learn 很高时（如 0.99）后验会被 clip 成恰好 1.0，
 * 而 p=1 是**吸收态** —— 贝叶斯更新的分子分母都退化成 slip，
 * 之后无论答错多少次都仍是 1。学生会永久停在「已掌握」，
 * 这比显示 99.9% 危险得多。夹在 (ε, 1−ε) 才能保证证据永远可以纠正它。
 */
const P_FLOOR = 1e-6;
const P_CEIL = 1 - 1e-6;

function clampProbability(p: number): number {
  if (!Number.isFinite(p)) return P_FLOOR;
  return Math.min(P_CEIL, Math.max(P_FLOOR, p));
}

export function initialState(params: BktParams = DEFAULT_BKT): MasteryKernelState {
  return { pKnown: clampProbability(params.prior), attempts: 0 };
}

/**
 * 一次贝叶斯更新 + 一次学习转移。
 * 顺序不能反：先按观测修正后验，再走转移（Corbett & Anderson 1995）。
 */
export function bktUpdate(
  state: MasteryKernelState,
  obs: { correct: boolean },
  params: BktParams = DEFAULT_BKT,
): MasteryKernelState {
  const p = state.pKnown;
  const { slip, guess, learn } = params;

  const numerator = obs.correct ? p * (1 - slip) : p * slip;
  const denominator = obs.correct
    ? p * (1 - slip) + (1 - p) * guess
    : p * slip + (1 - p) * (1 - guess);

  // 分母在极端参数下可能为 0，退化为先验而不是 NaN
  const posterior = denominator === 0 ? p : numerator / denominator;
  const next = posterior + (1 - posterior) * learn;

  return {
    pKnown: clampProbability(next),
    attempts: state.attempts + 1,
  };
}

/**
 * 判掌握必须同时满足：P(known) 过阈 AND 作答次数够。
 * 单看 P(known) 会让两次蒙对冲破 95%。
 */
export function isMastered(state: MasteryKernelState): boolean {
  return state.pKnown >= MASTERY_THRESHOLD && state.attempts >= MASTERY_MIN_ATTEMPTS;
}

/** 连续答对直到跨过 threshold 所需的次数；用于展示「还差几次」 */
export function masteredAt(threshold: number, params: BktParams = DEFAULT_BKT, maxRounds = 100): number | null {
  let s = initialState(params);
  for (let i = 1; i <= maxRounds; i += 1) {
    s = bktUpdate(s, { correct: true }, params);
    if (s.pKnown >= threshold) return i;
  }
  return null;
}

/**
 * 指数衰减。`halfLifeDays` 为该类知识的记忆半衰期：
 * 事实 14 天 / 概念 30 天 / 综合 45 天（设计推断，无直接文献）。
 */
export function decay(value: number, elapsedDays: number, halfLifeDays: number): number {
  if (elapsedDays <= 0) return value;
  if (halfLifeDays <= 0) return value;
  return value * Math.pow(0.5, elapsedDays / halfLifeDays);
}

export type KnowledgeKind = 'fact' | 'concept' | 'comprehensive';

export const HALF_LIFE_DAYS: Record<KnowledgeKind, number> = {
  fact: 14,
  concept: 30,
  comprehensive: 45,
};

/** 由 kind 与最近一次证据时间算出 current；achieved 由调用方单调维护，不经过这里 */
export function currentFromEvidence(
  achieved: number,
  kind: KnowledgeKind,
  elapsedDays: number,
): number {
  return decay(achieved, elapsedDays, HALF_LIFE_DAYS[kind]);
}
