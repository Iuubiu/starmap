/**
 * 状态映射单测：五档 → 四类、第二编码（形状）、百分比文案。
 *
 * 票 03 的第 3、7 条靠这层保证：四类必须真的可辨（形状互异），且「需复验」
 * 不能被自己的凭空规则造出来（必须来自 reviewDueAt）。
 */
import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../api/generated/model';
import {
  FINE_LABEL,
  formatPercent,
  nodeAccessibleLabel,
  SHAPE_NAMES,
  STATUS_COLOR,
  STATUS_LABEL,
  STATUS_ORDER,
  STATUS_SHAPE,
  toDisplayStatus,
  type DisplayStatus,
  type MasteryState,
} from './status.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');

function node(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    microKpId: 'kp-x',
    name: '某个微知识点',
    state: 'unseen',
    percent: null,
    depth: 1,
    ordinal: 1,
    moduleId: 'm-a',
    moduleName: '模块甲',
    moduleOrdinal: 1,
    reviewDueAt: null,
    ...overrides,
  };
}

describe('toDisplayStatus', () => {
  it('五档逐个映射到正确的四类', () => {
    const cases: Array<[MasteryState, DisplayStatus]> = [
      ['unseen', 'unseen'],
      ['attempted', 'learning'],
      ['familiar', 'learning'],
      ['proficient', 'mastered'],
      ['mastered', 'mastered'],
    ];
    for (const [state, expected] of cases) {
      expect(toDisplayStatus(node({ state }), NOW)).toBe(expected);
    }
  });

  it('reviewDueAt 已到期时覆盖成「需复验」，即使已掌握', () => {
    const due = node({ state: 'mastered', reviewDueAt: '2026-10-19T00:00:00.000Z' });
    expect(toDisplayStatus(due, NOW)).toBe('review');
  });

  it('reviewDueAt 恰好等于现在也算到期（<= 而非 <）', () => {
    expect(toDisplayStatus(node({ reviewDueAt: NOW.toISOString() }), NOW)).toBe('review');
  });

  it('reviewDueAt 在未来不算到期，回到原本的类别', () => {
    const future = node({ state: 'mastered', reviewDueAt: '2026-11-01T00:00:00.000Z' });
    expect(toDisplayStatus(future, NOW)).toBe('mastered');
  });

  it('未学节点即使 reviewDueAt 到期也显示需复验 —— 到期优先', () => {
    // 现实里不会出现（未学没有排期），但映射规则必须是「到期优先」而不是
    // 「先看 state 再看到期」，否则两个条件的组合会产生两套行为
    expect(toDisplayStatus(node({ state: 'unseen', reviewDueAt: '2026-01-01T00:00:00.000Z' }), NOW)).toBe(
      'review',
    );
  });

  it('reviewDueAt 是非法字符串时不抛错、也不误判为到期', () => {
    expect(toDisplayStatus(node({ state: 'familiar', reviewDueAt: '不是日期' }), NOW)).toBe('learning');
  });

  it('今天真实数据（reviewDueAt 全为 null）不会凭空出现需复验', () => {
    // 票 07 落地前 reviewDueAt 恒为 null，四类里「需复验」应当自然缺席
    for (const state of ['unseen', 'attempted', 'familiar', 'proficient', 'mastered'] as const) {
      expect(toDisplayStatus(node({ state, reviewDueAt: null }), NOW)).not.toBe('review');
    }
  });
});

describe('第二编码：形状', () => {
  it('四类各有互不相同的形状', () => {
    const shapes = STATUS_ORDER.map((status) => STATUS_SHAPE[status]);
    expect(new Set(shapes).size).toBe(4);
  });

  it('形状名都是 sigma 内置 SDF 形状的注册名', () => {
    // 传错名字时 sigma 会静默回退到第一个形状，形状编码就悄悄退化成全是圆
    for (const status of STATUS_ORDER) {
      expect(SHAPE_NAMES).toContain(STATUS_SHAPE[status] as (typeof SHAPE_NAMES)[number]);
    }
  });

  it('回退形状（circle）属于「未学」，是四种里最常见的一种', () => {
    expect(STATUS_SHAPE.unseen).toBe('circle');
    expect(SHAPE_NAMES[0]).toBe('circle');
  });

  it('颜色也不是唯一通道：四类颜色互不相同', () => {
    const colors = STATUS_ORDER.map((status) => STATUS_COLOR[status]);
    expect(new Set(colors).size).toBe(4);
  });

  it('四类的中文名逐字对应票面用词', () => {
    expect(STATUS_LABEL.unseen).toBe('未学');
    expect(STATUS_LABEL.learning).toBe('在学');
    expect(STATUS_LABEL.mastered).toBe('已掌握');
    expect(STATUS_LABEL.review).toBe('需复验');
  });

  it('STATUS_ORDER 覆盖全部四类，不重不漏', () => {
    expect([...STATUS_ORDER].sort()).toEqual(Object.keys(STATUS_LABEL).sort());
  });
});

describe('formatPercent', () => {
  it('null 是「证据不足」，不是 0%', () => {
    // 票 03 之前就有的规则，smoke.spec.ts 专门断言过
    expect(formatPercent(null)).toBe('证据不足');
    expect(formatPercent(null)).not.toBe('0%');
  });

  it('0 是「0%」—— 答过但全错跟没有证据是两件事', () => {
    expect(formatPercent(0)).toBe('0%');
  });

  it('四舍五入到整数百分比', () => {
    expect(formatPercent(0.66)).toBe('66%');
    expect(formatPercent(0.665)).toBe('67%');
    expect(formatPercent(1)).toBe('100%');
  });
});

describe('nodeAccessibleLabel', () => {
  it('格式是「名称，五档状态，百分比或证据不足」', () => {
    const label = nodeAccessibleLabel(node({ name: '布尔代数基本运算', state: 'familiar', percent: 0.66 }));
    expect(label).toBe('布尔代数基本运算，已熟悉，66%');
  });

  it('以节点名开头、「，」分隔 —— smoke.spec.ts 靠 split("，")[0] 取节点名', () => {
    const label = nodeAccessibleLabel(node({ name: '卡诺图化简', state: 'unseen', percent: null }));
    expect(label.split('，')[0]).toBe('卡诺图化简');
  });

  it('五档中文词表保留「未学习 / 已熟悉 / 已掌握」', () => {
    // e2e 用 /未学习|已熟悉|已掌握|生疏/ 匹配可访问名，换词会连带改别人的测试
    expect(FINE_LABEL.unseen).toBe('未学习');
    expect(FINE_LABEL.familiar).toBe('已熟悉');
    expect(FINE_LABEL.mastered).toBe('已掌握');
  });
});
