import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_BKT,
  MASTERY_MIN_ATTEMPTS,
  MASTERY_THRESHOLD,
  bktUpdate,
  decay,
  initialState,
  isMastered,
  masteredAt,
} from './mastery.js';

/**
 * 属性测试。选的是**不变式**而不是样例值 —— 样例值我在写实现时手算错过
 * 两次（连续答对第 3 次就到 0.967，第 4 次是 0.992，不是我以为的 0.9x），
 * 所以这里断言「无论输入什么，这些关系都必须成立」。
 */
describe('BKT 掌握度（属性）', () => {
  it('后验概率恒在 (0,1) 开区间内——BKT 是概率不是分数', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 200 }),
        fc.record({
          prior: fc.double({ min: 0.01, max: 0.99, noNaN: true }),
          learn: fc.double({ min: 0.01, max: 0.99, noNaN: true }),
          slip: fc.double({ min: 0.01, max: 0.49, noNaN: true }),
          guess: fc.double({ min: 0.01, max: 0.49, noNaN: true }),
        }),
        (answers, params) => {
          let state = initialState(params);
          for (const correct of answers) {
            state = bktUpdate(state, { correct }, params);
            expect(state.pKnown).toBeGreaterThan(0);
            expect(state.pKnown).toBeLessThan(1);
            expect(Number.isFinite(state.pKnown)).toBe(true);
            expect(Number.isInteger(state.attempts)).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('全对序列的后验单调不减', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), (n) => {
        let prev = -1;
        let state = initialState();
        for (let i = 0; i < n; i += 1) {
          state = bktUpdate(state, { correct: true });
          expect(state.pKnown).toBeGreaterThanOrEqual(prev);
          prev = state.pKnown;
        }
      }),
      { numRuns: 100 },
    );
  });

  it('全错序列的后验收敛到正的地板，绝不归零', () => {
    // 这是 BKT 的真实性质：转移项 (1-p)*learn 每轮把后验往上拉，
    // 连续答错会收敛到由 learn 决定的下限，而不是 0。
    // 如果哪天改成归零，说明实现被改坏了 —— 那会让「不可能学会」变成默认假设。
    let state = initialState();
    for (let i = 0; i < 100; i += 1) {
      state = bktUpdate(state, { correct: false });
    }
    expect(state.pKnown).toBeGreaterThan(0.05);
    expect(state.pKnown).toBeLessThan(DEFAULT_BKT.prior);
  });

  it('证据不足时 isMastered 恒为 false，无论概率多高', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.96, max: 0.999, noNaN: true }),
        fc.integer({ min: 0, max: MASTERY_MIN_ATTEMPTS - 1 }),
        (pKnown, attempts) => {
          // 只有 P(known) 过阈**且**作答次数够，两个条件才同时成立
          expect(isMastered({ pKnown, attempts })).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('decay 单调递减且永不为负，半衰期处恰好减半', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        fc.integer({ min: 0, max: 90 }),
        fc.integer({ min: 1, max: 90 }),
        (p0, elapsedDays, halfLife) => {
          const d = decay(p0, elapsedDays, halfLife);
          expect(d).toBeGreaterThanOrEqual(0);
          expect(d).toBeLessThanOrEqual(p0);
          expect(Number.isFinite(d)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
    expect(decay(0.8, 30, 30)).toBeCloseTo(0.4, 10);
    expect(decay(0.8, 60, 30)).toBeCloseTo(0.2, 10);
    expect(decay(0.8, 0, 30)).toBeCloseTo(0.8, 10);
  });

  it('连续答对跨过阈值后，继续答对不会回落到阈值以下', () => {
    const n = masteredAt(MASTERY_THRESHOLD);
    expect(n).not.toBeNull();
    let state = initialState();
    const seq: number[] = [];
    for (let i = 1; i <= (n ?? 0) + 20; i += 1) {
      state = bktUpdate(state, { correct: true });
      seq.push(state.pKnown);
    }
    const idx = (n ?? 1) - 1;
    for (let i = idx; i < seq.length; i += 1) {
      expect(seq[i]).toBeGreaterThanOrEqual(MASTERY_THRESHOLD);
    }
  });

  it('单次蒙对不足以判定掌握（isMastered 是双条件）', () => {
    let state = initialState();
    state = bktUpdate(state, { correct: true });
    expect(isMastered(state)).toBe(false);
  });

  it('概率永不触及 1，因此证据永远可以把它拉下来（不存在吸收态）', () => {
    // 属性测试发现过的真实缺陷：learn=0.99 时 clip 到恰好 1.0，
    // 而 p=1 之后贝叶斯更新的分子分母都退化成 slip，**任何证据都改不动它**。
    // 现在夹在 (1e-6, 1-1e-6) 开区间内。
    const extreme = { prior: 0.9, learn: 0.99, slip: 0.01, guess: 0.01 };
    let state = initialState(extreme);
    for (let i = 0; i < 300; i += 1) {
      state = bktUpdate(state, { correct: true }, extreme);
    }
    expect(state.pKnown).toBeLessThan(1);

    // 用真实参数（DEFAULT_BKT）验证「答错能拉下来」。注意不能用 learn=0.99：
    // 那时学习转移每轮把 (1−p) 的 99% 补回去，答错的修正会被立刻淹没，
    // 这是参数的数学后果而不是缺陷 —— 但也说明 learn 不能设得接近 1。
    let realistic = initialState();
    for (let i = 0; i < 60; i += 1) {
      realistic = bktUpdate(realistic, { correct: true });
    }
    const before = realistic.pKnown;
    expect(before).toBeGreaterThan(MASTERY_THRESHOLD);
    realistic = bktUpdate(realistic, { correct: false });
    expect(realistic.pKnown).toBeLessThan(before);
  });

  it('极端参数下的后验仍是有限数，不产生 NaN 或 Infinity', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 50 }),
        fc.constantFrom(
          { prior: 0.999, learn: 0.999, slip: 0.001, guess: 0.001 },
          { prior: 0.001, learn: 0.001, slip: 0.499, guess: 0.499 },
          { prior: 0.5, learn: 0.5, slip: 0.5, guess: 0.5 },
        ),
        (answers, params) => {
          let state = initialState(params);
          for (const correct of answers) {
            state = bktUpdate(state, { correct }, params);
            expect(Number.isFinite(state.pKnown)).toBe(true);
            expect(state.pKnown).toBeGreaterThan(0);
            expect(state.pKnown).toBeLessThan(1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
