import { describe, expect, it } from 'vitest';
import { evaluateExitGate, GATE_RULES } from './gating.js';

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
