import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_BKT, HALF_LIFE_DAYS, MASTERY_MIN_ATTEMPTS, MASTERY_MIN_VARIANTS, MASTERY_THRESHOLD } from './mastery.js';
import type { EvidenceEvent } from './mastery.js';
import { countDistinctVariants, replayMastery } from './mastery.js';

/**
 * 证据回放（票 05）。
 *
 * 这一层是「作答记录 → 两个百分比」的唯一实现。放纯函数是因为它必须满足
 * 三条不变量（答对不降低 current、答错不升高 current、半衰期处恰好减半），
 * 而这类保证只能用属性测试覆盖 —— 样例测不出「某个参数组合下会反向」。
 *
 * 本文件先写（TDD），`countDistinctVariants` / `replayMastery` 是随后补的实现。
 */

const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);

const at = (minute: number): string => new Date(T0 + minute * 60_000).toISOString();

/** 造一串作答：全部落在同一时刻，便于只观察 BKT 后验本身 */
const series = (answers: readonly boolean[]): EvidenceEvent[] =>
  answers.map((correct, i) => ({
    itemId: `i-${i}`,
    // 每道题各自一个变式组：本文件的重点不是去重，是后验
    variantGroup: `vg-${i}`,
    kind: 'concept' as const,
    correct,
    at: at(0),
  }));

describe('变式数按 variant_group 去重（ADR-0004）', () => {
  it('同一 variant_group 两次作答后 variantCount 仍为 1', () => {
    // 这条是票 05 的验收原文：平行题与它平行的题共用同组，因而不增加计数。
    // 若实现按 item_id 去重，这个断言会得到 2。
    const events: EvidenceEvent[] = [
      { itemId: 'i-a1', variantGroup: 'vg-absorb', kind: 'concept', correct: true, at: at(0) },
      { itemId: 'i-a2', variantGroup: 'vg-absorb', kind: 'concept', correct: false, at: at(1) },
    ];
    expect(countDistinctVariants(events)).toBe(1);
    expect(replayMastery(events, at(2)).variantCount).toBe(1);
    // 作数还是 2 次：变式数去重，但作答次数不去重
    expect(replayMastery(events, at(2)).attemptCount).toBe(2);
  });

  it('三个不同组 = 三个变式，重复作答不改变它', () => {
    const events: EvidenceEvent[] = [
      { itemId: 'i-1', variantGroup: 'vg-a', kind: 'fact', correct: true, at: at(0) },
      { itemId: 'i-2', variantGroup: 'vg-a', kind: 'fact', correct: true, at: at(1) },
      { itemId: 'i-3', variantGroup: 'vg-b', kind: 'concept', correct: true, at: at(2) },
      { itemId: 'i-4', variantGroup: 'vg-c', kind: 'concept', correct: false, at: at(3) },
      { itemId: 'i-5', variantGroup: 'vg-c', kind: 'concept', correct: true, at: at(4) },
    ];
    expect(countDistinctVariants(events)).toBe(3);
    const result = replayMastery(events, at(5));
    expect(result.variantCount).toBe(3);
    expect(result.attemptCount).toBe(5);
  });

  it('没有证据时一切归零，不给假数字', () => {
    const result = replayMastery([], at(0));
    expect(result.attemptCount).toBe(0);
    expect(result.variantCount).toBe(0);
    expect(result.evidenceSufficient).toBe(false);
    expect(result.state).toBe('unseen');
    expect(result.lastEvidenceAt).toBeNull();
    expect(result.achieved).toBe(0);
  });
});

describe('双字段：achieved 不衰减，current 衰减', () => {
  it('achieved 取历史最高后验，跨时间不变；current 随时间下降', () => {
    const events: EvidenceEvent[] = [
      { itemId: 'i-1', variantGroup: 'vg-a', kind: 'concept', correct: true, at: at(0) },
      { itemId: 'i-2', variantGroup: 'vg-b', kind: 'concept', correct: true, at: at(1) },
      { itemId: 'i-3', variantGroup: 'vg-c', kind: 'concept', correct: true, at: at(2) },
    ];
    const sameDay = replayMastery(events, at(3));
    const later = replayMastery(events, at(3 + 30 * 24 * 60));

    expect(later.achieved).toBe(sameDay.achieved);
    expect(later.current).toBeLessThan(sameDay.current);
    // 30 天正好是「概念」的半衰期 → current 恰好减半
    expect(later.current).toBeCloseTo(sameDay.current / 2, 6);
  });

  it('答错只降低 current，回不到 achieved 之上也不会拉低历史最高', () => {
    const good = series([true, true, true]);
    const thenWrong = [...good, { itemId: 'i-x', variantGroup: 'vg-x', kind: 'concept' as const, correct: false, at: at(0) }];
    const before = replayMastery(good, at(0));
    const after = replayMastery(thenWrong, at(0));
    expect(after.achieved).toBe(before.achieved);
    expect(after.current).toBeLessThan(before.current);
  });

  it('半衰期按知识类型取值，混合证据时取占比最高的那一类', () => {
    const conceptHeavy: EvidenceEvent[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        itemId: `i-c${i}`,
        variantGroup: `vg-c${i}`,
        kind: 'concept' as const,
        correct: true,
        at: at(0),
      })),
      { itemId: 'i-f0', variantGroup: 'vg-f0', kind: 'fact' as const, correct: true, at: at(0) },
    ];
    expect(replayMastery(conceptHeavy, at(0)).halfLifeDays).toBe(HALF_LIFE_DAYS.concept);

    const factOnly = series([true]).map((e) => ({ ...e, kind: 'fact' as const }));
    expect(replayMastery(factOnly, at(0)).halfLifeDays).toBe(HALF_LIFE_DAYS.fact);
  });

  it('占比持平时取更短半衰期（保守），不取更长', () => {
    const tie: EvidenceEvent[] = [
      { itemId: 'i-1', variantGroup: 'vg-1', kind: 'fact', correct: true, at: at(0) },
      { itemId: 'i-2', variantGroup: 'vg-2', kind: 'comprehensive', correct: true, at: at(0) },
    ];
    expect(replayMastery(tie, at(0)).halfLifeDays).toBe(HALF_LIFE_DAYS.fact);
  });
});

describe('证据门槛：≥3 变式且 ≥8 次作答', () => {
  it('7 次作答不够', () => {
    const events = series(Array.from({ length: 7 }, () => true));
    const result = replayMastery(events, at(0));
    expect(result.attemptCount).toBe(7);
    expect(result.evidenceSufficient).toBe(false);
    expect(result.state).not.toBe('mastered');
  });

  it('8 次作答但只有 2 个变式也不够', () => {
    const events: EvidenceEvent[] = Array.from({ length: 8 }, (_, i) => ({
      itemId: `i-${i}`,
      variantGroup: i % 2 === 0 ? 'vg-a' : 'vg-b',
      kind: 'fact' as const,
      correct: true,
      at: at(0),
    }));
    const result = replayMastery(events, at(0));
    expect(result.attemptCount).toBe(8);
    expect(result.variantCount).toBe(2);
    expect(result.evidenceSufficient).toBe(false);
  });

  it('8 次作答 + 3 变式 + 后验过阈 → mastered', () => {
    const events: EvidenceEvent[] = Array.from({ length: 8 }, (_, i) => ({
      itemId: `i-${i}`,
      variantGroup: `vg-${i % 3}`,
      kind: 'fact' as const,
      correct: true,
      at: at(0),
    }));
    const result = replayMastery(events, at(0));
    expect(result.variantCount).toBe(3);
    expect(result.achieved).toBeGreaterThanOrEqual(MASTERY_THRESHOLD);
    expect(result.evidenceSufficient).toBe(true);
    expect(result.state).toBe('mastered');
  });

  it('门槛常量与引擎内核一致', () => {
    expect(MASTERY_MIN_ATTEMPTS).toBe(8);
    expect(MASTERY_MIN_VARIANTS).toBe(3);
  });
});

describe('确定性：同一串作答得到同一结果', () => {
  it('两次调用逐字段相等', () => {
    const events = series([true, false, true, true]);
    expect(replayMastery(events, at(10))).toEqual(replayMastery(events, at(10)));
  });

  it('不读系统时钟：把 Date.now 换成别的值，输出不变', () => {
    const events = series([true, true]);
    const before = replayMastery(events, at(5));
    const realNow = Date.now;
    Date.now = () => 0;
    try {
      expect(replayMastery(events, at(5))).toEqual(before);
    } finally {
      Date.now = realNow;
    }
  });

  it('输入顺序不影响结果——回放按事件时间排序', () => {
    // 事件必须带**互不相同**的时间戳，这条测试才有意义。全部同一时刻时
    // 「谁先谁后」在数据里根本不存在（只有入参顺序能决定），排序也就无从
    // 谈起 —— 那种情况下保持入参顺序是唯一不引入隐藏随机的方式。
    const ordered: EvidenceEvent[] = [
      { itemId: 'i-1', variantGroup: 'vg-1', kind: 'concept', correct: true, at: at(0) },
      { itemId: 'i-2', variantGroup: 'vg-2', kind: 'concept', correct: false, at: at(5) },
      { itemId: 'i-3', variantGroup: 'vg-3', kind: 'concept', correct: true, at: at(9) },
    ];
    const shuffled = [ordered[2]!, ordered[0]!, ordered[1]!];
    expect(replayMastery(shuffled, at(10))).toEqual(replayMastery(ordered, at(10)));
  });

  it('同一时刻的多条证据保持入参顺序（数据库查询顺序稳定）', () => {
    const sameMoment = series([true, false]);
    // 时刻相同 → 无法从数据判定先后，按入参顺序回放。
    // 调用方负责保证取数时 ORDER BY created_at, id 让顺序稳定。
    expect(replayMastery(sameMoment, at(0)).pKnown).not.toBe(
      replayMastery([sameMoment[1]!, sameMoment[0]!], at(0)).pKnown,
    );
  });
});

describe('不变量（属性测试）', () => {
  /**
   * 单调性只在**同一评估时刻**比较才有意义：跨越时间比较时，衰减会降低
   * current，那是「遗忘」这个设计意图，不是违反单调性。
   *
   * 所以这里固定 evaluatedAt = 最后一条证据的时刻（经过 0 天衰减），
   * 让断言落在 BKT 后验本身。
   *
   * 另外**空历史不能参与比较**：零证据时输出的是 0 这个哨兵值（表示「还没
   * 有数据」），不是后验。拿哨兵和后验比大小是范畴错误 —— 「从没答过」不该
   * 和「答错一次」比谁的掌握度高。空历史的契约由上一条 describe 的
   * 「没有证据时一切归零」单独覆盖。
   */
  it('答对不降低 current', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 30 }), (answers) => {
        const base = series(answers);
        const withCorrect: EvidenceEvent[] = [
          ...base,
          { itemId: 'i-new', variantGroup: 'vg-new', kind: 'concept', correct: true, at: at(0) },
        ];
        const before = replayMastery(base, at(0)).current;
        const after = replayMastery(withCorrect, at(0)).current;
        expect(after).toBeGreaterThanOrEqual(before - 1e-12);
      }),
      { numRuns: 200 },
    );
  });

  it('答错不升高 current', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 30 }), (answers) => {
        const base = series(answers);
        const withWrong: EvidenceEvent[] = [
          ...base,
          { itemId: 'i-new', variantGroup: 'vg-new', kind: 'concept', correct: false, at: at(0) },
        ];
        const before = replayMastery(base, at(0)).current;
        const after = replayMastery(withWrong, at(0)).current;
        expect(after).toBeLessThanOrEqual(before + 1e-12);
      }),
      { numRuns: 200 },
    );
  });

  it('衰减到半衰期时恰好减半', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { maxLength: 20 }),
        fc.constantFrom('fact' as const, 'concept' as const, 'comprehensive' as const),
        (answers, kind) => {
          const events = series(answers).map((e) => ({ ...e, kind }));
          const fresh = replayMastery(events, at(0));
          const halfLife = HALF_LIFE_DAYS[kind];
          const decayed = replayMastery(events, at(halfLife * 24 * 60));
          expect(decayed.current).toBeCloseTo(fresh.current / 2, 6);
          // achieved 不随时间变
          expect(decayed.achieved).toBe(fresh.achieved);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('后验恒在 (0,1) 开区间，且 attemptCount 恒等于事件数', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 60 }), (answers) => {
        const events = series(answers);
        const result = replayMastery(events, at(0));
        expect(result.current).toBeGreaterThan(0);
        expect(result.current).toBeLessThan(1);
        expect(result.attemptCount).toBe(events.length);
        expect(result.variantCount).toBeLessThanOrEqual(events.length);
      }),
      { numRuns: 100 },
    );
  });

  it('零证据时 current 与 achieved 都是 0 这个哨兵值（不是先验 0.25）', () => {
    const empty = replayMastery([], at(0));
    expect(empty.current).toBe(0);
    expect(empty.achieved).toBe(0);
    expect(empty.pKnown).toBe(0);
  });

  it('current 单调不减于 achieved 的下界：current ≤ achieved 且 ≥ 0', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 40 }), fc.integer({ min: 0, max: 400 }), (answers, days) => {
        const events = series(answers);
        const result = replayMastery(events, at(days * 24 * 60));
        expect(result.current).toBeLessThanOrEqual(result.achieved + 1e-12);
        expect(result.current).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });
});

describe('BKT 参数可由调用方覆盖（同一套内核，不同档位）', () => {
  it('更高的 learn 让同样一道答对涨得更多', () => {
    const events = series([true]);
    const lazy = replayMastery(events, at(0), { ...DEFAULT_BKT, learn: 0.05 });
    const eager = replayMastery(events, at(0), { ...DEFAULT_BKT, learn: 0.5 });
    expect(eager.current).toBeGreaterThan(lazy.current);
  });
});
