import { describe, expect, it } from 'vitest';
import { bktUpdate, decay, DEFAULT_BKT, initialState, isMastered, masteredAt } from './mastery.js';

/**
 * 期望值来自独立手算（写在注释里），不是重跑实现。
 * BKT 四参数：prior p(L0) / learn t / slip s / guess g
 * 更新公式（Corbett & Anderson 1995）：
 *   观察正确后：  P(L|+) = p(1-s) / (p(1-s) + (1-p)g)
 *   观察错误后：  P(L|-) = p·s / (p·s + (1-p)(1-g))
 *   然后转移：    p' = P(L|obs) + (1-P(L|obs))·t
 */
describe('bktUpdate', () => {
  it('首次答对：0.25 起步，举一反三后应显著上升而非暴涨', () => {
    const s0 = initialState(DEFAULT_BKT);
    const s1 = bktUpdate(s0, { correct: true }, DEFAULT_BKT);
    // 手算：p=0.25, s=0.10, g=0.25
    // P(L|+) = 0.25*0.9 / (0.25*0.9 + 0.75*0.25) = 0.225/0.4125 = 0.545454...
    // p' = 0.545454 + 0.454545*0.15 = 0.545454 + 0.068182 = 0.613636
    expect(s1.pKnown).toBeCloseTo(0.6136, 3);
    expect(s1.attempts).toBe(1);
  });

  it('答错会下降，但不会被一次错误打回原点', () => {
    const s0 = initialState(DEFAULT_BKT);
    const s1 = bktUpdate(s0, { correct: false }, DEFAULT_BKT);
    // 手算：P(L|-) = 0.25*0.1 / (0.25*0.1 + 0.75*0.75) = 0.025/0.5875 = 0.042553
    // p' = 0.042553 + 0.957447*0.15 = 0.042553 + 0.143617 = 0.186170
    expect(s1.pKnown).toBeCloseTo(0.1862, 3);
  });

  it('连续答对会收敛到接近 1 但不越过 1', () => {
    let s = initialState(DEFAULT_BKT);
    for (let i = 0; i < 30; i += 1) s = bktUpdate(s, { correct: true }, DEFAULT_BKT);
    expect(s.pKnown).toBeGreaterThan(0.99);
    expect(s.pKnown).toBeLessThanOrEqual(1);
  });

  it('连续答错不会归零，而是收敛到一个由 learn 决定的地板', () => {
    // 这是 BKT 的真实性质，不是 bug：每轮转移项 (1-posterior)*learn 会把后验往上拉。
    // 独立计算得收敛值约 0.1731（learn=0.15 时），不会跌到 0。
    let s = initialState(DEFAULT_BKT);
    for (let i = 0; i < 30; i += 1) s = bktUpdate(s, { correct: false }, DEFAULT_BKT);
    expect(s.pKnown).toBeGreaterThan(0.15);
    expect(s.pKnown).toBeLessThan(0.2);
    // 单调性：第 1 次错误下降最多，之后几乎不动
    const afterOne = bktUpdate(initialState(DEFAULT_BKT), { correct: false }, DEFAULT_BKT);
    expect(afterOne.pKnown).toBeCloseTo(0.1862, 3);
    expect(s.pKnown).toBeLessThan(afterOne.pKnown);
  });
});

describe('isMastered 的双条件', () => {
  it('只答对两次不能算掌握，哪怕 pKnown 已过 0.95', () => {
    // 这是 OATutor 的教训：两次蒙对就能冲破 95%，所以必须加 attempts 门槛
    let s = initialState(DEFAULT_BKT);
    s = bktUpdate(s, { correct: true }, DEFAULT_BKT);
    s = bktUpdate(s, { correct: true }, DEFAULT_BKT);
    expect(s.pKnown).toBeGreaterThan(0.5);
    expect(isMastered(s)).toBe(false);
  });

  it('达到 0.95 且作答次数够才判掌握', () => {
    let s = initialState(DEFAULT_BKT);
    for (let i = 0; i < 12; i += 1) s = bktUpdate(s, { correct: true }, DEFAULT_BKT);
    expect(isMastered(s)).toBe(true);
    expect(s.attempts).toBeGreaterThanOrEqual(8);
  });
});

describe('masteredAt 阈值', () => {
  it('返回跨过阈值的准确次数，而不是布尔', () => {
    // 手算 p 序列：0.25 -> 0.6136 -> 0.8734 -> 0.9671
    // 0.9 阈值在第 3 次后首次跨过（第 2 次时 0.8734 仍低于阈值）
    expect(masteredAt(0.9)).toBe(3);
  });
});

describe('decay 只作用于 current，不作用于 achieved', () => {
  it('一个半衰期衰减到一半，两个半衰期到四分之一', () => {
    // 半衰期 30 天：30 天后 0.8 -> 0.4；60 天后 0.8 -> 0.2
    expect(decay(0.8, 30, 30)).toBeCloseTo(0.4, 6);
    expect(decay(0.8, 60, 30)).toBeCloseTo(0.2, 6);
    // 0 天不衰减
    expect(decay(0.8, 0, 30)).toBeCloseTo(0.8, 6);
    // 负天数按 0 处理，不能让时间倒流提高掌握度
    expect(decay(0.8, -5, 30)).toBeCloseTo(0.8, 6);
  });
});
