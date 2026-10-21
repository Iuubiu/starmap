import { describe, expect, it } from 'vitest';
import {
  REVIEW_INTERVALS_DAYS,
  REVIEW_ITEMS_MAX,
  REVIEW_ITEMS_MIN,
  advanceReviewSchedule,
  initialReviewSchedule,
  interleaveReviewItems,
  isReviewDue,
  overdueDays,
  reviewIntervalDays,
  reviewPassCount,
  reviewPassed,
  selectReviewItems,
  type ReviewCandidate,
} from './review.js';

/**
 * 复验排期（票 07）。
 *
 * 这一层是「什么时候该复验、下一次排到哪天、这一次算不算过」的唯一实现。
 * 放在 engine 的纯函数里，理由与 ADR-0003 相同：时序决策不做成后台任务。
 * 定时器（cron / Workflow）在这里没有任何位置 —— 排期是一个**存下来的时刻**，
 * 由查询时用 `<= now` 比较，而不是「到点了去推一个事件」。
 *
 * 本文件先写（TDD），`review.ts` 是随后补的实现。
 */

const DAY = 86_400_000;
const T0 = '2026-03-01T00:00:00.000Z';

const plus = (iso: string, days: number): string =>
  new Date(Date.parse(iso) + days * DAY).toISOString();

describe('复验间隔序列（票面：1/3/7/21/60 天）', () => {
  it('序列逐字等于票面数值，不许悄悄改一位', () => {
    expect(REVIEW_INTERVALS_DAYS).toEqual([1, 3, 7, 21, 60]);
  });

  it('每次复验抽 3–5 题', () => {
    expect(REVIEW_ITEMS_MIN).toBe(3);
    expect(REVIEW_ITEMS_MAX).toBe(5);
  });

  it('`reviewIntervalDays` 把阶段号翻成天数，越界夹到两端', () => {
    expect(reviewIntervalDays(0)).toBe(1);
    expect(reviewIntervalDays(1)).toBe(3);
    expect(reviewIntervalDays(2)).toBe(7);
    expect(reviewIntervalDays(3)).toBe(21);
    expect(reviewIntervalDays(4)).toBe(60);
    expect(reviewIntervalDays(-1)).toBe(1);
    expect(reviewIntervalDays(99)).toBe(60);
    // 非整数/NaN 不抛错，按第一档处理（调用方拿到的是可用值而不是异常）
    expect(reviewIntervalDays(1.7)).toBe(3);
    expect(reviewIntervalDays(Number.NaN)).toBe(1);
  });
});

describe('第一次排期：掌握那天起 1 天', () => {
  it('刚被判定为 mastered 时排到 +1 天，阶段 0', () => {
    const schedule = initialReviewSchedule(T0, 'mastered');
    expect(schedule).toEqual({ stage: 0, nextDueAt: plus(T0, 1) });
  });

  it('还没掌握就不排期 —— 「需复验」只能出现在已掌握的知识点上', () => {
    for (const state of ['proficient', 'familiar', 'attempted', 'unseen']) {
      expect(initialReviewSchedule(T0, state)).toBeNull();
    }
  });

  it('坏时间戳拒绝排期，而不是算出 Invalid Date 落库', () => {
    expect(initialReviewSchedule('不是日期', 'mastered')).toBeNull();
  });
});

describe('通过则推进到下一个间隔', () => {
  it('0→1→2→3→4 依次落在 3/7/21/60 天', () => {
    const steps = [
      { from: 0, days: 3 },
      { from: 1, days: 7 },
      { from: 2, days: 21 },
      { from: 3, days: 60 },
    ];
    for (const step of steps) {
      const next = advanceReviewSchedule({ stage: step.from, passed: true, completedAt: T0 });
      expect(next.stage).toBe(step.from + 1);
      expect(next.nextDueAt).toBe(plus(T0, step.days));
    }
  });

  it('走到最长一档就停住：60 天之后仍是 60 天，不会溢出成 undefined', () => {
    const next = advanceReviewSchedule({ stage: 4, passed: true, completedAt: T0 });
    expect(next.stage).toBe(4);
    expect(next.nextDueAt).toBe(plus(T0, 60));
  });
});

describe('未通过则回到更早的间隔', () => {
  it('阶段 2 失败退到 1（7 天 → 3 天）', () => {
    const next = advanceReviewSchedule({ stage: 2, passed: false, completedAt: T0 });
    expect(next.stage).toBe(1);
    expect(next.nextDueAt).toBe(plus(T0, 3));
  });

  it('阶段 0 失败原地不动：仍是最短的 1 天，不会退成负数', () => {
    const next = advanceReviewSchedule({ stage: 0, passed: false, completedAt: T0 });
    expect(next.stage).toBe(0);
    expect(next.nextDueAt).toBe(plus(T0, 1));
  });
});

describe('到期判定（与图谱共用同一列、同一个 <= 比较）', () => {
  it('没排期 = 不到期', () => {
    expect(isReviewDue(null, T0)).toBe(false);
  });

  it('未来的排期不到期，恰好等于现在算到期', () => {
    expect(isReviewDue(plus(T0, 1), T0)).toBe(false);
    expect(isReviewDue(T0, T0)).toBe(true);
    expect(isReviewDue(plus(T0, -1), T0)).toBe(true);
  });

  it('坏日期不误判为到期 —— 与前端 toDisplayStatus 的取舍一致', () => {
    expect(isReviewDue('不是日期', T0)).toBe(false);
    expect(isReviewDue(T0, '不是日期')).toBe(false);
  });

  it('逾期天数向下取整、负数夹到 0', () => {
    expect(overdueDays(plus(T0, -3), T0)).toBe(3);
    expect(overdueDays(plus(T0, -3.9), T0)).toBe(3);
    expect(overdueDays(plus(T0, 2), T0)).toBe(0);
    expect(overdueDays('不是日期', T0)).toBe(0);
  });
});

describe('通过判据：错题数决定过不过', () => {
  it('3 题需 3 对、4 题需 4 对、5 题需 4 对（20% 容错只在 5 题时成立）', () => {
    expect(reviewPassCount(3)).toBe(3);
    expect(reviewPassCount(4)).toBe(4);
    expect(reviewPassCount(5)).toBe(4);
  });

  it('边界：差一题就是不通过', () => {
    expect(reviewPassed(3, 3)).toBe(true);
    expect(reviewPassed(2, 3)).toBe(false);
    expect(reviewPassed(4, 5)).toBe(true);
    expect(reviewPassed(3, 5)).toBe(false);
  });

  it('0 题不算通过（没有证据就不是通过）', () => {
    expect(reviewPassed(0, 0)).toBe(false);
    expect(reviewPassCount(0)).toBe(0);
  });
});

describe('挑题：避开原题、跨变式组、3–5 题', () => {
  const candidate = (itemId: string, variantGroup: string): ReviewCandidate => ({
    itemId,
    variantGroup,
  });

  it('优先抽没做过的原题（同一道题重做不算复验）', () => {
    const pool = [
      candidate('i-a1', 'vg-a'),
      candidate('i-a2', 'vg-a'),
      candidate('i-b1', 'vg-b'),
      candidate('i-c1', 'vg-c'),
      candidate('i-d1', 'vg-d'),
    ];
    const picked = selectReviewItems(pool, ['i-a1', 'i-a2', 'i-b1', 'i-c1', 'i-d1']);
    // 全是原题时仍要给出可抽的题（否则学习者永远无法复验），但只要有新题就先给新题
    const fresh = selectReviewItems(pool, ['i-a1', 'i-b1']);
    expect(fresh.map((item) => item.itemId)).toContain('i-c1');
    expect(fresh.map((item) => item.itemId)).not.toContain('i-a1');
    expect(picked.length).toBeGreaterThanOrEqual(3);
  });

  it('先让每个变式组各出一题，再回头补同组的第二题', () => {
    const pool = [
      candidate('i-a1', 'vg-a'),
      candidate('i-a2', 'vg-a'),
      candidate('i-b1', 'vg-b'),
      candidate('i-c1', 'vg-c'),
      candidate('i-c2', 'vg-c'),
    ];
    const picked = selectReviewItems(pool, []);
    expect(picked).toHaveLength(5);
    // 前三个互不相同的变式组 —— 「不同 variant_group 抽」的落点
    const firstThree = picked.slice(0, 3).map((item) => item.variantGroup);
    expect(new Set(firstThree).size).toBe(3);
  });

  it('最多 5 题，哪怕池子有 20 道', () => {
    const pool = Array.from({ length: 20 }, (_, i) => candidate(`i-${i}`, `vg-${i}`));
    expect(selectReviewItems(pool, [])).toHaveLength(5);
  });

  it('池子不足 3 题时返回现有的，不编造题目', () => {
    const picked = selectReviewItems([candidate('i-a1', 'vg-a'), candidate('i-b1', 'vg-b')], []);
    expect(picked.map((item) => item.itemId)).toEqual(['i-a1', 'i-b1']);
  });

  it('同一道题在池子里出现两次（多张关卡复用）只抽一次', () => {
    const picked = selectReviewItems(
      [candidate('i-a1', 'vg-a'), candidate('i-a1', 'vg-a'), candidate('i-b1', 'vg-b')],
      [],
    );
    expect(picked.map((item) => item.itemId)).toEqual(['i-a1', 'i-b1']);
  });

  it('输入顺序不影响结果（复验题单可重复：同样数据永远同一份题单）', () => {
    const pool = [
      candidate('i-c1', 'vg-c'),
      candidate('i-a1', 'vg-a'),
      candidate('i-b1', 'vg-b'),
      candidate('i-a2', 'vg-a'),
      candidate('i-d1', 'vg-d'),
    ];
    const shuffled = [pool[3], pool[0], pool[4], pool[2], pool[1]];
    expect(selectReviewItems(pool, []).map((i) => i.itemId)).toEqual(
      selectReviewItems(shuffled, []).map((i) => i.itemId),
    );
  });
});

describe('多知识点交错，而不是同一个连考', () => {
  it('三组题按轮转交错：A1 B1 C1 A2 B2', () => {
    const ordered = interleaveReviewItems([
      ['a1', 'a2'],
      ['b1', 'b2'],
      ['c1'],
    ]);
    expect(ordered).toEqual(['a1', 'b1', 'c1', 'a2', 'b2']);
  });

  it('只有一组时原样返回（单知识点不强行打乱）', () => {
    expect(interleaveReviewItems([['a1', 'a2', 'a3']])).toEqual(['a1', 'a2', 'a3']);
  });

  it('空输入返回空数组', () => {
    expect(interleaveReviewItems([])).toEqual([]);
    expect(interleaveReviewItems([[], []])).toEqual([]);
  });

  it('相邻两题永远来自不同知识点（只要还有别的组有题）', () => {
    const ordered = interleaveReviewItems([
      ['a1', 'a2', 'a3', 'a4'],
      ['b1', 'b2', 'b3'],
      ['c1', 'c2'],
    ]);
    // 只有最后一组剩下的题才可能与上一题同源
    for (let i = 1; i < ordered.length; i += 1) {
      const prevGroup = ordered[i - 1][0];
      const group = ordered[i][0];
      const remaining = ordered.slice(i + 1).some((item) => item[0] !== group);
      if (prevGroup === group) expect(remaining).toBe(false);
    }
  });
});
