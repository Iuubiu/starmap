/**
 * 状态计数与图例的单测。
 *
 * 图例上的数字不是装饰：学习者打开地图第一件想知道的事是「我还有多少没学」。
 * 所以「按四类计数」是真逻辑（依赖到期判定），必须能被测试钉住 —— 尤其是
 * 「整图计数」与「当前视野计数」两个数字不能混。
 */
import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../api/generated/model';
import { countByStatus } from './StatusLegend.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');

function node(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    microKpId: 'kp-x',
    name: 'x',
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

describe('countByStatus', () => {
  it('空图四类都是 0', () => {
    expect(countByStatus([], NOW)).toEqual({ unseen: 0, learning: 0, mastered: 0, review: 0 });
  });

  it('五档状态按四类归并', () => {
    const counts = countByStatus(
      [
        node({ state: 'unseen' }),
        node({ state: 'attempted' }),
        node({ state: 'familiar' }),
        node({ state: 'proficient' }),
        node({ state: 'mastered' }),
      ],
      NOW,
    );
    expect(counts).toEqual({ unseen: 1, learning: 2, mastered: 2, review: 0 });
  });

  it('到期的已掌握节点计入「需复验」而不是「已掌握」', () => {
    const counts = countByStatus(
      [
        node({ state: 'mastered', reviewDueAt: '2026-10-01T00:00:00.000Z' }),
        node({ state: 'mastered', reviewDueAt: null }),
      ],
      NOW,
    );
    expect(counts.mastered).toBe(1);
    expect(counts.review).toBe(1);
  });

  it('总数等于输入节点数（不重不漏）', () => {
    const nodes = [
      node({ state: 'unseen' }),
      node({ state: 'familiar' }),
      node({ state: 'mastered', reviewDueAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const counts = countByStatus(nodes, NOW);
    const sum = counts.unseen + counts.learning + counts.mastered + counts.review;
    expect(sum).toBe(nodes.length);
  });
});
