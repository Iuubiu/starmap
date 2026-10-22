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

// ---------------------------------------------------------------------------
// 证据回放：作答记录 → 两个百分比
// ---------------------------------------------------------------------------

/**
 * 一条作答证据。字段刻意只留回放必需的东西 —— 不含 `created_at` 之外的时间、
 * 不含数据库自增 id，这样同一串事件无论从哪里取出都得出同一个结果。
 *
 * `variantGroup` 是**去重键**：同一微知识点内平行题共用一组（spec L247），
 * 所以「做了三道平行题」只算覆盖了一个变式，不增加变式数（ADR-0004）。
 */
export interface EvidenceEvent {
  itemId: string;
  variantGroup: string;
  kind: KnowledgeKind;
  correct: boolean;
  /** 作答时刻，ISO 8601。回放按它排序，并在它之上算衰减 */
  at: string;
}

/** 掌握度五态。与 `app.mastery.state` 的 CHECK 约束逐字一致 */
export type MasteryState = 'mastered' | 'proficient' | 'familiar' | 'attempted' | 'unseen';

export interface MasterySnapshot {
  /** 历史最高后验。不衰减，管解锁 */
  achieved: number;
  /** 当前后验按半衰期衰减后的值。管推荐与检索门控 */
  current: number;
  /** 五态标签。`attempted` 同时覆盖「刚做了一次」和「做了很多次但证据还不够」 */
  state: MasteryState;
  attemptCount: number;
  /** 按 `variantGroup` 去重后的变式数 */
  variantCount: number;
  /** ≥3 变式且 ≥8 次作答。false 时调用方**不得**输出百分比 */
  evidenceSufficient: boolean;
  /** 回放结束时的裸后验，只用于诊断与测试，不对外展示 */
  pKnown: number;
  /** 本次衰减采用的半衰期（天），由证据里占比最高的知识类型决定 */
  halfLifeDays: number;
  /** 最后一条证据的时刻；无证据时为 null */
  lastEvidenceAt: string | null;
}

/** 五态阈值。仓库里此前没有先例，这里定下来并写进测试： */
export const FAMILIAR_THRESHOLD = 0.4;
export const PROFICIENT_THRESHOLD = 0.7;

/**
 * 变式数：按 `variantGroup` 去重。
 *
 * **不能用 itemId 去重** —— 平行题（同组、题干换数字）本来就是为了让学习者
 * 多练几次而不算多会一个变式，按题去重会让「刷同一道题的三个版本」冒充
 * 「掌握了三种变式」，那正是变式门槛要防的事。
 */
export function countDistinctVariants(events: readonly EvidenceEvent[]): number {
  return new Set(events.map((event) => event.variantGroup)).size;
}

/**
 * 半衰期取证据里占比最高的知识类型；占比持平取**更短**的那个。
 *
 * 持平时保守取值（取更短半衰期 = 衰减更快 = 更快提示复习）。反过来会让
 * 「一半事实一半综合」的知识点享有综合类的 45 天半衰期，而事实类本来该
 * 14 天就提醒复习。
 */
function dominantHalfLife(events: readonly EvidenceEvent[]): number {
  if (events.length === 0) return HALF_LIFE_DAYS.concept;

  const counts = new Map<KnowledgeKind, number>();
  for (const event of events) {
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  }

  let best: KnowledgeKind = 'concept';
  let bestCount = -1;
  let bestHalfLife = Number.POSITIVE_INFINITY;
  for (const [kind, count] of counts) {
    const halfLife = HALF_LIFE_DAYS[kind];
    if (count > bestCount || (count === bestCount && halfLife < bestHalfLife)) {
      best = kind;
      bestCount = count;
      bestHalfLife = halfLife;
    }
  }
  return HALF_LIFE_DAYS[best];
}

function toMillis(iso: string): number {
  const ms = Date.parse(iso);
  // 坏时间戳不能静默变成 NaN 再污染整条回放：当作「最早」处理，但这属于
  // 上游数据错误，所以用 0 而不是「现在」—— 后者会让结果依赖系统时钟。
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * 回放一串作答，得出双字段掌握度。
 *
 * 语义（逐条对应票 05 验收）：
 * - `achieved` = 折演过程中后验的**历史最大值**，因此单调不减、永不衰减；
 * - `current` = 折演结束时后验按「距最后一条证据的天数」衰减，所以答错会降、
 *   时间流逝会降、答对会升；
 * - 时长为 0 天时 `current` 就等于裸后验，两者相减就是衰减量。
 *
 * 确定性：不读系统时钟、不用随机数、不依赖 Map 迭代顺序（比较时同时比
 * 计数与半衰期），事件按时间排序（同时刻保持入参顺序），所以同一串输入
 * 无论调用几次、在什么时刻调用，输出逐字段相同。
 */
export function replayMastery(
  events: readonly EvidenceEvent[],
  evaluatedAt: string,
  params: BktParams = DEFAULT_BKT,
): MasterySnapshot {
  const ordered = events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => toMillis(a.event.at) - toMillis(b.event.at) || a.index - b.index)
    .map(({ event }) => event);

  let state = initialState(params);
  let achieved = 0;
  for (const event of ordered) {
    state = bktUpdate(state, { correct: event.correct }, params);
    achieved = Math.max(achieved, state.pKnown);
  }

  const attemptCount = ordered.length;
  const variantCount = countDistinctVariants(ordered);
  const evidenceSufficient = attemptCount >= MASTERY_MIN_ATTEMPTS && variantCount >= MASTERY_MIN_VARIANTS;

  const last = ordered[ordered.length - 1];
  const lastEvidenceAt = last ? last.at : null;
  const halfLifeDays = dominantHalfLife(ordered);
  const elapsedDays = last ? (toMillis(evaluatedAt) - toMillis(last.at)) / 86_400_000 : 0;
  const current = decay(state.pKnown, elapsedDays, halfLifeDays);

  return {
    // 无证据时 0 而不是 prior：先验 0.25 是算法起点，不是「学习者会了两成半」
    achieved: attemptCount === 0 ? 0 : achieved,
    current: attemptCount === 0 ? 0 : current,
    state: deriveState(attemptCount, evidenceSufficient, current),
    attemptCount,
    variantCount,
    evidenceSufficient,
    pKnown: attemptCount === 0 ? 0 : state.pKnown,
    halfLifeDays,
    lastEvidenceAt,
  };
}

/**
 * 五态派生。证据不足时**不许**给出 familiar 以上 —— 两次蒙对不该显示为「已熟悉」。
 * 与 `app.mastery.state` 的 CHECK 一致，所以这里返回值可直接落库。
 */
export function deriveState(
  attemptCount: number,
  evidenceSufficient: boolean,
  current: number,
): MasteryState {
  if (attemptCount === 0) return 'unseen';
  if (!evidenceSufficient) return 'attempted';
  if (current >= MASTERY_THRESHOLD) return 'mastered';
  if (current >= PROFICIENT_THRESHOLD) return 'proficient';
  if (current >= FAMILIAR_THRESHOLD) return 'familiar';
  return 'attempted';
}

/**
 * 非叶节点颜色：子节点按**证据量**加权聚合（ADR-0004）。
 *
 * 为什么按证据量不按简单平均：一个只做过 1 道题的子节点和一个做过 20 道题
 * 的子节点对父节点颜色的贡献不该相同，否则父节点色会随「哪些孩子被碰过」
 * 剧烈跳动。为什么只读派生、不落库：一份证据只能计权一次，落库就会让同一
 * 道题同时抬高它自己和所有祖先（ADR-0004 的核心禁止事项）。
 *
 * 证据量为 0 的子节点不参与（不把平均值往下拉），全部为 0 时返回 null，
 * 由调用方渲染成「未学习」而不是 0%。
 */
export function aggregateEvidence(
  children: readonly { value: number; weight: number }[],
): number | null {
  let weighted = 0;
  let weight = 0;
  for (const child of children) {
    if (child.weight <= 0) continue;
    weighted += child.value * child.weight;
    weight += child.weight;
  }
  if (weight === 0) return null;
  return weighted / weight;
}
