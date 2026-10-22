import { describe, expect, it } from 'vitest';
import {
  appliedThreshold,
  clopperPearsonLower,
  evaluateExitGate,
  GATE_RULES,
  requiredCorrectFor,
} from './gating.js';

/**
 * 门控用二项分布下界，不是简单的「答对 7/8 算过」。
 * 期望值来自二项分布独立计算（见注释），不是重跑实现。
 */
describe('evaluateExitGate', () => {
  it('章末出口：8 题答对 7 才算过', () => {
    const rule = GATE_RULES.exit;
    expect(rule.itemCount).toBe(8);
    expect(rule.passCount).toBe(7);
    expect(evaluateExitGate(7, 8, rule).passed).toBe(true);
    expect(evaluateExitGate(6, 8, rule).passed).toBe(false);
  });

  it('高入度先修：10 题答对 9 才算过', () => {
    const rule = GATE_RULES.prereq;
    expect(rule.itemCount).toBe(10);
    expect(rule.passCount).toBe(9);
    expect(evaluateExitGate(9, 10, rule).passed).toBe(true);
    expect(evaluateExitGate(8, 10, rule).passed).toBe(false);
  });

  it('题量不足时判「未判定」，不能当通过', () => {
    const r = evaluateExitGate(5, 5, GATE_RULES.exit);
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('insufficient_items');
    expect(r.verdict).toBe('undetermined');
  });

  it('题量不足时报的是「还差几道题要做」，不是「还差几道答对」', () => {
    // 曾在探针里看到 5 题全对却报「还差 2 道」—— 那个 2 是 7-5（答对缺口），
    // 而学习者该做的是「再做 3 题」。前端读这个数当行动建议，方向反了。
    expect(evaluateExitGate(5, 5, GATE_RULES.exit).shortfall).toBe(3);
    expect(evaluateExitGate(0, 3, GATE_RULES.exit).shortfall).toBe(5);
  });

  it('mode 为 none 时永不放行，因为关内不该有门', () => {
    const r = evaluateExitGate(8, 8, { mode: 'none', itemCount: 8, passCount: 7 });
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('no_gate_configured');
  });

  it('给出可解释的差距，而不是只说失败', () => {
    const r = evaluateExitGate(5, 8, GATE_RULES.exit);
    expect(r.verdict).toBe('failed');
    expect(r.shortfall).toBe(2);
    expect(r.message).toContain('2');
  });

  it('答对数超过题量时按边界截断，不产生负差距', () => {
    const r = evaluateExitGate(9, 8, GATE_RULES.exit);
    expect(r.passed).toBe(true);
    expect(r.shortfall).toBe(0);
  });
});

/**
 * ## 为什么门控要换成下界（这一段是本文件里最重要的部分）
 *
 * 换成下界之前，判定是裸计数 `correct >= passCount`，与题量无关：
 * n=8 要 87.5%、n=16 只要 43.8%、n=20 只要 35%。**越考越松** ——
 * 多做题反而更容易蒙过，这与「多做题是为了证明实力」完全相反。
 *
 * 换成 `clopperPearsonLower(k, n, 0.5) >= 0.75` 之后，通过所需的正确率
 * 随 n 单调收敛到 80%：n=8 需 7/8（87.5%）、n=10 需 9/10（90%）、
 * n=20 需 16/20（80%）。下面这些数字全部由二项分布独立算出，
 * 不是把实现跑一遍抄回来。
 */
describe('二项下界（独立计算）', () => {
  it('单侧 50% Clopper–Pearson 下界在关键点上的值', () => {
    // 数值来自 P(X ≥ k | n, p) = 0.5 反解，手工核对过 7/8 与 9/10 两点：
    // P(X ≥ 7 | 8, 0.7989) = 0.5001，P(X ≥ 9 | 10, 0.8377) = 0.5000
    expect(clopperPearsonLower(7, 8, 0.5)).toBeCloseTo(0.7989, 3);
    expect(clopperPearsonLower(6, 8, 0.5)).toBeCloseTo(0.6795, 3);
    expect(clopperPearsonLower(9, 10, 0.5)).toBeCloseTo(0.8377, 3);
    expect(clopperPearsonLower(8, 10, 0.5)).toBeCloseTo(0.7414, 3);
  });

  it('全对分支必须是下界公式 alpha^(1/n)，不是 1-alpha^(1/n)', () => {
    // 这条守的是一个真实发生过的错误：闭式解被写成上界公式，8/8 的
    // 50% 下界算出 8.3%（应为 91.7%）。它没被上面任何一条测试抓到，
    // 因为 requiredCorrectFor 从 k=0 往上扫，n=8 在第 7 题就满足阈值，
    // **永远走不到 k=n**。全对是最该给出最强证据的情形，成了唯一盲区。
    expect(clopperPearsonLower(8, 8, 0.5)).toBeCloseTo(Math.pow(0.5, 1 / 8), 10);
    expect(clopperPearsonLower(8, 8, 0.5)).toBeCloseTo(0.917, 3);
    // 文件头引用过的那个数：n=8 全对的 **95%** 下界是 68.8%。它对不上
    // 0.917 是因为 alpha 不同（0.05 vs 0.5），不是矛盾 —— 两个都写在这里，
    // 免得下次又有人以为其中一个算错了。
    expect(clopperPearsonLower(8, 8, 0.05)).toBeCloseTo(0.6877, 3);
    expect(clopperPearsonLower(30, 30, 0.05)).toBeCloseTo(0.9047, 3);
    // 单调性：同一 n 下 k 越多，下界越高
    const series = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => clopperPearsonLower(k, 8, 0.5));
    for (let i = 1; i < series.length; i++) expect(series[i]!).toBeGreaterThan(series[i - 1]!);
  });

  it('题量越多，达标所需正确率趋近但仍然严格', () => {
    expect(requiredCorrectFor(8)).toBe(7);
    expect(requiredCorrectFor(10)).toBe(9);
    expect(requiredCorrectFor(16)).toBe(13);
    expect(requiredCorrectFor(20)).toBe(16);
    expect(requiredCorrectFor(30)).toBe(24);
    // 每条都要真能过（防止 required 算成 n+1 那种「永远过不了」）
    for (const n of [8, 10, 16, 20, 30]) {
      const k = requiredCorrectFor(n);
      expect(clopperPearsonLower(k, n, 0.5)).toBeGreaterThanOrEqual(0.75);
      if (k > 1) expect(clopperPearsonLower(k - 1, n, 0.5)).toBeLessThan(0.75);
    }
  });

  it('越考越松的旧行为不会再回来', () => {
    // 裸计数 `correct >= 7` 下，20 题答对 7 题（35%）就能过。
    // 下界下 20 题要 16 题。这条断言的就是「多做题不等于更容易过」。
    expect(evaluateExitGate(7, 20, GATE_RULES.exit).passed).toBe(false);
    expect(evaluateExitGate(16, 20, GATE_RULES.exit).passed).toBe(true);
    expect(evaluateExitGate(15, 20, GATE_RULES.exit).passed).toBe(false);
  });
});

describe('appliedThreshold', () => {
  it('题量超过规则声明值时，回报的是这一题量下真实的达标线', () => {
    // 界面拿 rule 渲染「达标线 7/8」。若学习者做了 20 题、答对 12，
    // 显示 7/8 会让人以为早该过了，而判定其实是不过的 —— 自相矛盾。
    expect(appliedThreshold(GATE_RULES.exit, 8)).toEqual({ itemCount: 8, passCount: 7 });
    expect(appliedThreshold(GATE_RULES.exit, 20)).toEqual({ itemCount: 20, passCount: 16 });
    expect(appliedThreshold(GATE_RULES.prereq, 10)).toEqual({ itemCount: 10, passCount: 9 });
  });

  it('题量不足时按规则题量给达标线，因为那时还算不上下界', () => {
    expect(appliedThreshold(GATE_RULES.exit, 3)).toEqual({ itemCount: 8, passCount: 7 });
  });
});
