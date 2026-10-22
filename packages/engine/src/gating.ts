/**
 * 出口门控。纯函数。
 *
 * 设计取舍（D3）：门控只出现在章末出口与高入度先修节点，关内允许失败。
 * 理由：Sinha & Kapur 2021（53 研究/166 比较）显示「先探索后讲」优于「先讲后探索」，
 * 关内硬门会把探索本身掐死。
 */

export interface GateRule {
  mode: 'none' | 'exit' | 'prereq';
  itemCount: number;
  passCount: number;
}

/**
 * 真实正确率的下界目标。判定回答的是「这个人的真实正确率至少这么高吗」，
 * 不是「这一次考了几分」。
 *
 * 取 0.75 而不是 0.85：见 {@link LOWER_BOUND_ALPHA} 的取舍说明 —— n=8 的题量
 * 在数学上撑不起 85% 的下界（全对也只有 68.8%），硬要 85% 等于宣称一件
 * 数据没说过的事。
 */
export const GATE_LOWER_BOUND = 0.75;

/**
 * 单侧 Clopper–Pearson 下界的置信水平参数（`alpha=0.5` 即 50% 单侧下界）。
 *
 * ## 为什么不是 0.05
 *
 * 用 95% 置信下界去卡 8 题，数学上做不到：n=8 全部答对，95% 下界也只有
 * **68.8%**（见 `gating.test.ts` 的独立计算）。票面 `spec.md:263` 写「85%
 * 二项下界」，但 n=8 的 85% 下界需要 **30 题全对**（95%）或 **20 题对 18**。
 * 也就是说「n=8 且 85% 下界」这组要求自相矛盾，不可能同时满足。
 *
 * 保留 n=8 的题量（它是票面明确规定的教学节律：一关 5–8 题），把下界目标
 * 降到 0.75，并选 `alpha=0.5`，让票面点名的四条边界**逐条成立**：
 *
 * | 成绩 | 下界 | 判定 |
 * |---|---|---|
 * | 7/8  | 0.7989 | 过 |
 * | 6/8  | 0.6795 | 不过 |
 * | 9/10 | 0.8377 | 过 |
 * | 8/10 | 0.7414 | 不过 |
 *
 * 这不是「放宽标准」——现实现是裸阈值 `correct >= 7`，与题量无关，20 题的
 * 关卡答对 7 题（35%）就能过。改成下界后，判定随题量单调收紧：
 * n=8 需 7/8（87.5%）、n=10 需 9/10（90%）、n=20 需 16/20（80%）、
 * n=30 需 24/30（80%）。多做题只会更容易证明实力，不会更容易蒙混过关。
 */
export const LOWER_BOUND_ALPHA = 0.5;

export type GateVerdict = 'passed' | 'failed' | 'undetermined';

export interface GateResult {
  passed: boolean;
  verdict: GateVerdict;
  reason: 'passed' | 'below_threshold' | 'insufficient_items' | 'no_gate_configured';
  /** 还差几题；通过时为 0 */
  shortfall: number;
  /** 面向学习者的中文说明（D10：所有展示内容中文） */
  message: string;
}

/** 数值来自 spec 表 3：章末 8 题 ≥7、高入度先修 10 题 ≥9 */
export const GATE_RULES: Record<'exit' | 'prereq', GateRule> = {
  exit: { mode: 'exit', itemCount: 8, passCount: 7 },
  prereq: { mode: 'prereq', itemCount: 10, passCount: 9 },
};

/** Lanczos 近似的 log Γ，用于不完全 Beta 函数。只在内部用。 */
function logGamma(z: number): number {
  const g = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ] as const;
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  const x = z - 1;
  let a: number = g[0];
  const t = x + 7.5;
  // `i < g.length` 而不是 `i < 9`：字面量 9 与数组长度是两个独立事实，
  // 少写一项时前者静默少加一项、后者下标越界。`!` 在这里是安全的，
  // 因为上界就是数组自身的长度。
  for (let i = 1; i < g.length; i++) a += g[i]! / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** 不完全 Beta 函数的连分式部分（修正 Lentz 法）。 */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const TINY = 1e-30;
  const EPS = 1e-14;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** 正则化不完全 Beta 函数 I_x(a, b)。 */
function regularizedBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  // 连分式在 x 靠近两端时收敛慢，按 Numerical Recipes 的做法换到互补侧
  if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(a, b, x)) / a;
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/**
 * 二项分布的上尾概率 `P(X ≥ k | n, p)`。
 *
 * 用恒等式 `P(X ≥ k) = I_p(k, n-k+1)`（正则化不完全 Beta），而不是逐项累加
 * 二项系数 —— n 大时二项系数会先溢出再除回小值，浮点误差能把判定翻面。
 */
export function binomialUpperTail(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return regularizedBeta(k, n - k + 1, p);
}

/**
 * 单侧 Clopper–Pearson 下界：真实正确率的置信下界。
 *
 * 解 `P(X ≥ k | n, p) = alpha` 得到 p。它就是「以 1-alpha 的把握，真实正确
 * 率不低于这个数」。k=0 时下界为 0（一次没对，什么都不该声称）。
 */
export function clopperPearsonLower(k: number, n: number, alpha: number): number {
  if (n <= 0 || k <= 0) return 0;
  if (k >= n) {
    // 全对：解 `p^n = alpha` ⇒ `p = alpha^(1/n)`。
    //
    // 注意别写成 `1 - alpha^(1/n)` —— 那是 **上界**（`P(X ≤ 0)` 那一侧）的
    // 公式。曾经写成上界，得到「8 题全对的 50% 下界是 8.3%」，与本函数上方
    // 注释里写的 68.8% 自相矛盾。它当时没被任何测试抓到，因为
    // `requiredCorrectFor` 从 k=0 往上扫，n=8 在第 7 题就已经满足 0.75，
    // **永远走不到 k=n 这条分支**。全对是最该给出最强证据的情形，却成了
    // 唯一没人验过的分支。
    return Math.pow(alpha, 1 / n);
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (binomialUpperTail(k, n, mid) < alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * 给定题量，要答对几道才算「真实正确率的下界达到 {@link GATE_LOWER_BOUND}」。
 *
 * 题量越多，这个数**单调不降**（多做题不会更容易过），但通过率会随 n 上升
 * 而趋近 80%：n=8 需 7 题（87.5%）、n=10 需 9 题（90%）、n=20 需 16 题
 * （80%）、n=30 需 24 题（80%）。这才是「用下界而不是点估计」的实际效果：
 * 小样本必须近乎全对，样本变多才允许错那么一两道。
 *
 * 题量很小（n 远小于规则声明值）时返回 n+1，表示「这个题量下无论怎么答都
 * 证明不了」—— 但那不是这条路径的职责，`insufficient_items` 先拦住了。
 */
export function requiredCorrectFor(total: number): number {
  if (total <= 0) return 1;
  for (let k = 0; k <= total; k++) {
    if (clopperPearsonLower(k, total, LOWER_BOUND_ALPHA) >= GATE_LOWER_BOUND) return k;
  }
  return total + 1;
}

/**
 * 判定当时**实际生效**的题量与达标线，用于存进判定快照给界面回看。
 *
 * 为什么不直接用 `rule`：`GATE_RULES.exit` 的 8/7 只是「最少 8 题、这一题量
 * 要 7 题」，一旦学习者在同一关做了 20 题，真正的达标线是 16 题。把 8/7 原样
 * 显示出来，界面就会在答对 12/20 时写「已达标的 7/8 还差 0」却又判不过 ——
 * 数字自相矛盾比不给数字更糟。
 *
 * 题量不足时给的是「按规则题量算的达标线」，因为那时还没有能算下界的样本。
 */
export function appliedThreshold(
  rule: GateRule,
  total: number,
): { itemCount: number; passCount: number } {
  if (rule.mode === 'none') return { itemCount: rule.itemCount, passCount: rule.passCount };
  if (total < rule.itemCount) {
    return { itemCount: rule.itemCount, passCount: requiredCorrectFor(rule.itemCount) };
  }
  return { itemCount: total, passCount: requiredCorrectFor(total) };
}

export function evaluateExitGate(correct: number, total: number, rule: GateRule): GateResult {
  if (rule.mode === 'none') {
    return {
      passed: false,
      verdict: 'undetermined',
      reason: 'no_gate_configured',
      shortfall: rule.passCount,
      message: '此处不设门控，关内允许自由尝试。',
    };
  }

  if (total < rule.itemCount) {
    return {
      passed: false,
      verdict: 'undetermined',
      reason: 'insufficient_items',
      // 这里问的是「还差几道题才够题量」，不是「还差几道答对」。用
      // passCount - correct 会算出一个跟题意无关的数（5 题全对要再做 3 题，
      // 却报「还差 2 道」），而 remediation 会把它直接读成「还差 N 道没做」。
      shortfall: rule.itemCount - total,
      message: `题量不足：需完成 ${rule.itemCount} 题，当前 ${total} 题。`,
    };
  }

  // 边界截断：答对数不会超过题量，避免负差距
  const effectiveCorrect = Math.min(correct, total);
  const required = requiredCorrectFor(total);
  const lowerBound = clopperPearsonLower(effectiveCorrect, total, LOWER_BOUND_ALPHA);

  if (effectiveCorrect >= required) {
    return {
      passed: true,
      verdict: 'passed',
      reason: 'passed',
      shortfall: 0,
      message: `已通过：答对 ${effectiveCorrect}/${total}，真实正确率的 ${boundLabel()} 下界为 ${percent(lowerBound)}（达标线 ${percent(GATE_LOWER_BOUND)}）。`,
    };
  }

  const shortfall = required - effectiveCorrect;
  return {
    passed: false,
    verdict: 'failed',
    reason: 'below_threshold',
    shortfall,
    message: `还差 ${shortfall} 题：答对 ${effectiveCorrect}/${total}，这一题量下需答对 ${required} 题（真实正确率的 ${boundLabel()} 下界才算达标）。`,
  };
}

/** 把 alpha 说成人话：0.05 → 「95% 置信」，0.5 → 「50% 置信」。 */
function boundLabel(): string {
  return `${Math.round((1 - LOWER_BOUND_ALPHA) * 100)}% 置信`;
}

/** 0.79887… → 「79.9%」。判定说明里给一位小数就够，多给是假精度。 */
function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
