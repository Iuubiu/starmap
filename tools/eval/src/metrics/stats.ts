/**
 * 统计工具：置信区间、bootstrap、一致性系数。
 *
 * ## 为什么自己写而不引依赖
 *
 * 这个包只有 zod 一个运行期依赖，而且会被 depcruise 巡航。为了四个不到 40 行
 * 的公式引入一个统计库，收益是负的：供应链面变大、版本升级要跟、而且这些
 * 公式的**口径**必须写清楚（Wilson 还是 Wald、bootstrap 的百分位还是 BCa），
 * 库的默认值往往与我们需要的不同。
 *
 * ## 三条纪律
 *
 * 1. **分母为 0 一律返回 null，不返回 0**。没有样本 ≠ 全部通过。这与产品侧
 *    `percent: null`（证据不足不写 0）是同一条纪律。
 * 2. **n < 30 必须能被调用方识别出来**，所有返回结构都带 `n`，报告层据此打
 *    「样本不足」。不在这里抛错或截断 —— 那是报告的决定，不是统计的决定。
 * 3. **系数算不出来时返回 null 并带原因**，不要返回一个看起来正常的 0。
 */

/** 比例的 Wilson 置信区间（默认 95%）。 */
export interface Interval {
  /** 点估计；分母为 0 时为 null。 */
  estimate: number | null;
  lower: number | null;
  upper: number | null;
  /** 分子 / 分母，报告里要能直接用 `k/n` 展示。 */
  numerator: number;
  denominator: number;
}

const Z_95 = 1.959963984540054;

/**
 * Wilson score interval。
 *
 * 为什么不用 Wald（`p ± z·sqrt(p(1-p)/n)`）：小样本或 p 接近 0/1 时 Wald 会
 * 给出负下界或超过 1 的上界，还会在 0/0 时直接除零。而我们的典型场景就是
 * 「20 个知识点里 2 个答错」这种小样本极端比例 —— Wald 在这里恰好最不可靠。
 * Wilson 在 n=8、k=8 时下界仍然 > 0.6，是它被选中的理由。
 */
export function wilsonInterval(numerator: number, denominator: number, z: number = Z_95): Interval {
  if (denominator <= 0) {
    return { estimate: null, lower: null, upper: null, numerator, denominator };
  }
  const n = denominator;
  const p = numerator / n;
  const z2 = z * z;
  const denominatorTerm = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denominatorTerm;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominatorTerm;
  return {
    estimate: p,
    lower: Math.max(0, centre - margin),
    upper: Math.min(1, centre + margin),
    numerator,
    denominator,
  };
}

/** 均值的 bootstrap 置信区间结果。 */
export interface BootstrapInterval {
  estimate: number | null;
  lower: number | null;
  upper: number | null;
  n: number;
  resamples: number;
}

/**
 * 均值的百分位 bootstrap 置信区间（默认 95%，2000 次重采样）。
 *
 * ## 为什么用固定种子的伪随机
 *
 * 报告里的数字必须**可复现**：同一份 transcript 跑两次要得到同一个区间，
 * 否则「上次测出来是 4.2 这次是 3.9」会被误读成产品变差了。用 LCG 而不是
 * `Math.random()`，种子由调用方给（默认固定 0x5eed）。
 *
 * ## 为什么 n < 2 时返回 null
 *
 * 一个样本的 bootstrap 区间宽度恒为 0 —— 那是「没有信息」而不是「很稳定」。
 * 报告层看到 null 会写「样本不足」。
 */
export function bootstrapMeanInterval(
  values: readonly number[],
  options: { resamples?: number; seed?: number; confidence?: number } = {},
): BootstrapInterval {
  const n = values.length;
  const resamples = options.resamples ?? 2000;
  const seed = options.seed ?? 0x5eed;
  const confidence = options.confidence ?? 0.95;
  if (n === 0) return { estimate: null, lower: null, upper: null, n, resamples };
  const estimate = values.reduce((sum, value) => sum + value, 0) / n;
  if (n < 2) return { estimate, lower: null, upper: null, n, resamples };

  /* 32 位 LCG（Numerical Recipes 常数）：周期足够长、实现三行、无依赖。
     不追求密码学质量 —— 这里只需要「每次跑一样」。 */
  let state = seed >>> 0;
  const nextFloat = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };

  const means: number[] = [];
  for (let iteration = 0; iteration < resamples; iteration += 1) {
    let sum = 0;
    for (let pick = 0; pick < n; pick += 1) {
      sum += values[Math.floor(nextFloat() * n)] as number;
    }
    means.push(sum / n);
  }
  means.sort((left, right) => left - right);
  const alpha = (1 - confidence) / 2;
  const at = (quantile: number): number => means[Math.min(means.length - 1, Math.max(0, Math.floor(quantile * means.length)))] as number;
  return { estimate, lower: at(alpha), upper: at(1 - alpha), n, resamples };
}

/** Cohen's κ 的结果；`value` 为 null 表示算不出来（见 `reason`）。 */
export interface KappaResult {
  value: number | null;
  reason: string | null;
  /** 参与计算的样本数。 */
  n: number;
  observedAgreement: number | null;
  expectedAgreement: number | null;
}

function countLabels(labels: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return counts;
}

/**
 * Cohen's κ（两个评分者对同一批样本的标签一致性）。
 *
 * κ = (p_o − p_e) / (1 − p_e)，其中 p_e 是「按两人各自的边际分布随机配对时
 * 碰巧一致的概率」。减掉 p_e 是关键：两个评分者都倾向于打「通过」时，
 * 原始一致率会虚高，κ 会把这个虚高扣掉。
 *
 * ## 什么情况下返回 null
 *
 * - 两侧长度不等：不是同一批样本，算出来没有意义。
 * - p_e === 1：两人给的是同一个常量标签。此时 κ 的分母是 0，数学上无定义。
 *   原始一致率是 100%，但那是**退化的一致**（一个永远说"好"的 judge 也是
 *   100%），报告层应写「无法计算（单一标签）」而不是 1.0。
 */
export function cohensKappa(left: readonly string[], right: readonly string[]): KappaResult {
  const n = left.length;
  if (n !== right.length) {
    return { value: null, reason: `两侧样本数不等：${left.length} vs ${right.length}`, n, observedAgreement: null, expectedAgreement: null };
  }
  if (n === 0) {
    return { value: null, reason: '没有样本', n: 0, observedAgreement: null, expectedAgreement: null };
  }

  let agree = 0;
  for (let index = 0; index < n; index += 1) {
    if (left[index] === right[index]) agree += 1;
  }
  const observed = agree / n;

  const leftCounts = countLabels(left);
  const rightCounts = countLabels(right);
  let expected = 0;
  const labels = new Set([...leftCounts.keys(), ...rightCounts.keys()]);
  for (const label of labels) {
    expected += ((leftCounts.get(label) ?? 0) / n) * ((rightCounts.get(label) ?? 0) / n);
  }

  if (expected >= 1) {
    return {
      value: null,
      reason: '两个评分者都只用了同一个标签，κ 的分母为 0（原始一致率 100% 是退化的一致）',
      n,
      observedAgreement: observed,
      expectedAgreement: expected,
    };
  }

  return { value: (observed - expected) / (1 - expected), reason: null, n, observedAgreement: observed, expectedAgreement: expected };
}

/** Fleiss' κ 的结果（多评分者、每样本评分者数可不同）。 */
export interface FleissResult {
  value: number | null;
  reason: string | null;
  n: number;
  observedAgreement: number | null;
  expectedAgreement: number | null;
}

/**
 * Fleiss' κ：`ratings[i]` 是第 i 个样本收到的各评分者标签。
 *
 * 与 Cohen's κ 的区别：允许两个以上评分者，且每个样本的评分者数可以不同
 * （我们的场景是「同一条 transcript 让 judge 跑 3 次」，但某些轮次可能只
 * 成功跑回 2 次 —— 解析失败的不算，见 `judge-runs.json`）。
 *
 * 公式：`P_i = (Σ_j n_ij² − n_i) / (n_i(n_i − 1))`，`P̄ = mean(P_i)`，
 * `P_e = Σ_j p_j²`，`κ = (P̄ − P_e) / (1 − P_e)`。
 */
export function fleissKappa(ratings: ReadonlyArray<readonly string[]>): FleissResult {
  const usable = ratings.filter((entry) => entry.length >= 2);
  const n = usable.length;
  if (n === 0) {
    return { value: null, reason: '没有任何一个样本收到 ≥2 个评分', n: 0, observedAgreement: null, expectedAgreement: null };
  }

  const perSample: number[] = [];
  const labelTotals = new Map<string, number>();
  let totalRatings = 0;

  for (const entry of usable) {
    const counts = countLabels(entry);
    const ni = entry.length;
    let sumSquares = 0;
    for (const count of counts.values()) sumSquares += count * count;
    perSample.push((sumSquares - ni) / (ni * (ni - 1)));
    for (const [label, count] of counts) labelTotals.set(label, (labelTotals.get(label) ?? 0) + count);
    totalRatings += ni;
  }

  const observed = perSample.reduce((sum, value) => sum + value, 0) / n;
  let expected = 0;
  for (const count of labelTotals.values()) {
    const proportion = count / totalRatings;
    expected += proportion * proportion;
  }

  if (expected >= 1) {
    return {
      value: null,
      reason: '所有评分者都只用了同一个标签，κ 的分母为 0',
      n,
      observedAgreement: observed,
      expectedAgreement: expected,
    };
  }
  return { value: (observed - expected) / (1 - expected), reason: null, n, observedAgreement: observed, expectedAgreement: expected };
}

/** 变异系数（标准差 / 均值）。均值接近 0 时返回 null —— 除以 0 得到的"稳定"是假的。 */
export function coefficientOfVariation(values: readonly number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  if (Math.abs(mean) < 1e-9) return null;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance) / Math.abs(mean);
}

/** 报告层的「样本不足」门槛：票 20 规定 n<30 要标注。 */
export const SMALL_SAMPLE_THRESHOLD = 30;

/**
 * 给报告用的展示：`62.5%（5/8，95% CI 30.6%–86.3%，样本不足）`。
 *
 * 分子分母**总是**打出来。只给百分比时读者无法判断 100% 是真全对还是 1/1，
 * 而后者在我们的样本量下极常见 —— 那恰恰是最容易被误读成"表现很好"的情形。
 */
export function formatInterval(interval: Interval, label = '95% CI'): string {
  if (interval.estimate === null) return '无样本（0 个）';
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const parts = [`${percent(interval.estimate)}（${interval.numerator}/${interval.denominator}`];
  if (interval.lower !== null && interval.upper !== null) {
    parts.push(`${label} ${percent(interval.lower)}–${percent(interval.upper)}`);
  }
  if (interval.denominator < SMALL_SAMPLE_THRESHOLD) parts.push('样本不足');
  return `${parts.join('，')}）`;
}

/** 给报告用的 bootstrap 展示。 */
export function formatBootstrap(interval: BootstrapInterval): string {
  if (interval.estimate === null) return '无样本（0 个）';
  if (interval.lower === null || interval.upper === null) return `${interval.estimate.toFixed(2)}（n=${interval.n}，样本不足，算不出区间）`;
  const small = interval.n < SMALL_SAMPLE_THRESHOLD ? '，样本不足' : '';
  return `${interval.estimate.toFixed(2)}（95% CI ${interval.lower.toFixed(2)}–${interval.upper.toFixed(2)}，n=${interval.n}${small}）`;
}
