/**
 * 布局层单测：建图、圆环种子、Worker 降级路径。
 *
 * 这里**不测力导向的结果**（FA2 是随机的、且 jsdom 没有 Worker），只测我们
 * 自己的契约：图建对了没有、种子位置确定不、没有 Worker 时会不会炸。
 * 真实布局与「不阻塞主线程」由 Playwright 断言（见 e2e/graph.spec.ts）。
 */
import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '../api/generated/model';
import { buildLayoutGraph, positionFingerprint, seedPositions, startLayout } from './layout.js';

function node(id: string): GraphNode {
  return {
    microKpId: id,
    name: `名称-${id}`,
    state: 'unseen',
    percent: null,
    depth: 1,
    ordinal: 1,
    moduleId: 'm-a',
    moduleName: '模块甲',
    moduleOrdinal: 1,
    reviewDueAt: null,
  };
}

function edge(from: string, to: string, kind: GraphEdge['kind'] = 'prereq'): GraphEdge {
  return { from, to, kind };
}

describe('seedPositions', () => {
  it('输出确定 —— 同一份数据两次运行位置相同', () => {
    // 空间记忆：刷新后节点不该换地方
    expect(seedPositions(5)).toEqual(seedPositions(5));
  });

  it('等角分布在单位圆上', () => {
    const positions = seedPositions(4);
    for (const p of positions) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 10);
    }
    // 4 个点应该两两不同
    const keys = new Set(positions.map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`));
    expect(keys.size).toBe(4);
  });

  it('单节点放在圆心，不跑到圆边上去', () => {
    expect(seedPositions(1)).toEqual([{ x: 0, y: 0 }]);
  });

  it('零节点返回空数组', () => {
    expect(seedPositions(0)).toEqual([]);
  });
});

describe('buildLayoutGraph', () => {
  it('节点带上坐标、标签与尺寸', () => {
    const graph = buildLayoutGraph([node('a')], []);
    expect(graph.order).toBe(1);
    const attributes = graph.getNodeAttributes('a');
    expect(attributes.label).toBe('名称-a');
    expect(Number.isFinite(attributes.x)).toBe(true);
    expect(Number.isFinite(attributes.y)).toBe(true);
    expect(attributes.size).toBeGreaterThan(0);
  });

  it('边被加入，且是有向图（保留先修方向）', () => {
    const graph = buildLayoutGraph([node('a'), node('b')], [edge('a', 'b')]);
    expect(graph.size).toBe(1);
    expect(graph.hasEdge('a', 'b')).toBe(true);
    expect(graph.hasEdge('b', 'a')).toBe(false);
  });

  it('端点不存在的边被跳过，不抛错', () => {
    // 图谱接口只返回叶节点，指向非叶节点的先修边会落在这种情况上
    const graph = buildLayoutGraph([node('a')], [edge('a', 'ghost')]);
    expect(graph.order).toBe(1);
    expect(graph.size).toBe(0);
  });

  it('同一对节点的重复边只加一次', () => {
    // multi:false 下手动重复 addEdge 会抛错，这里必须自己挡掉
    const graph = buildLayoutGraph(
      [node('a'), node('b')],
      [edge('a', 'b'), edge('a', 'b', 'related')],
    );
    expect(graph.size).toBe(1);
  });

  it('2000 个节点能建出来（票 03 的规模要求）', () => {
    const nodes = Array.from({ length: 2000 }, (_, i) => node(`kp-${i}`));
    const edges = Array.from({ length: 1999 }, (_, i) => edge(`kp-${i}`, `kp-${i + 1}`));
    const graph = buildLayoutGraph(nodes, edges);
    expect(graph.order).toBe(2000);
    expect(graph.size).toBe(1999);
  });
});

describe('positionFingerprint', () => {
  it('坐标变化时指纹跟着变（用来判断布局是否还在动）', () => {
    const graph = buildLayoutGraph([node('a'), node('b')], []);
    const before = positionFingerprint(graph);
    graph.setNodeAttribute('a', 'x', 42);
    expect(positionFingerprint(graph)).not.toBe(before);
  });
});

describe('startLayout（jsdom 无 Worker 的降级路径）', () => {
  it('没有 Worker 时不抛错，标记 usesWorker=false', () => {
    const graph = buildLayoutGraph([node('a'), node('b')], [edge('a', 'b')]);
    const handle = startLayout(graph);
    expect(handle.usesWorker).toBe(false);
    expect(handle.graph).toBe(graph);
    handle.stop();
  });

  it('stop() 可重复调用', () => {
    const handle = startLayout(buildLayoutGraph([node('a')], []));
    expect(() => {
      handle.stop();
      handle.stop();
    }).not.toThrow();
  });

  it('降级后坐标仍然是有限数（圆环种子保证画得出来）', () => {
    const handle = startLayout(buildLayoutGraph([node('a'), node('b')], []));
    handle.graph.forEachNode((key) => {
      const attributes = handle.graph.getNodeAttributes(key);
      expect(Number.isFinite(attributes.x)).toBe(true);
      expect(Number.isFinite(attributes.y)).toBe(true);
    });
    handle.stop();
  });
});
