/**
 * 拓扑层单测：邻接表、两跳邻域、跳数裁剪、主线排序。
 *
 * 这些用例刻意用**手搓的小图**而不是真实数据：真实库今天只有 167 个叶节点、
 * 52 条边且 109 个孤立点，靠它测「两跳」只会得到「1 个节点」这种什么都没
 * 证明的断言。手搓的图能把边界条件钉死。
 */
import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '../api/generated/model';
import {
  buildGraphIndex,
  clampHops,
  groupMainline,
  mainlineIndexOf,
  mainlineNeighbors,
  MAX_HOPS,
  neighborhood,
  orderMainline,
  visibleSubgraph,
} from './topology.js';

/** 造一个节点。默认是「未学习、无证据」，用例只覆盖自己关心的字段。 */
function node(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    microKpId: id,
    name: id,
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

function edge(from: string, to: string, kind: GraphEdge['kind'] = 'prereq'): GraphEdge {
  return { from, to, kind };
}

/**
 * 一条链 + 一个分叉：
 *
 * ```
 *   a → b → c → d        (链)
 *       ↘ e              (分叉)
 *   x                    (孤立)
 * ```
 */
const CHAIN_NODES = [node('a'), node('b'), node('c'), node('d'), node('e'), node('x')];
const CHAIN_EDGES = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('b', 'e')];

describe('buildGraphIndex', () => {
  it('按 id 建索引，并保留边方向', () => {
    const index = buildGraphIndex(CHAIN_NODES, CHAIN_EDGES);
    expect(index.byId.get('b')?.microKpId).toBe('b');
    expect([...(index.outgoing.get('b') ?? [])].sort()).toEqual(['c', 'e']);
    expect([...(index.incoming.get('b') ?? [])]).toEqual(['a']);
  });

  it('邻接是无向的：先修边两个方向都算邻居', () => {
    const index = buildGraphIndex(CHAIN_NODES, CHAIN_EDGES);
    // b 的后继 c/e、前置 a，都应出现在邻居里
    expect([...(index.neighbors.get('b') ?? [])].sort()).toEqual(['a', 'c', 'e']);
  });

  it('丢掉端点不存在的边，而不是留下悬空引用', () => {
    // 图谱接口只返回叶节点，但 prereq 允许指向非叶节点 —— 那种边必须被安静丢弃，
    // 否则 sigma 会拿到一个不存在的端点
    const index = buildGraphIndex([node('a')], [edge('a', 'ghost')]);
    expect([...(index.neighbors.get('a') ?? [])]).toEqual([]);
    expect(index.neighbors.has('ghost')).toBe(false);
  });

  it('同一对节点之间多条不同类型的边不会重复计算邻居', () => {
    const index = buildGraphIndex([node('a'), node('b')], [edge('a', 'b'), edge('a', 'b', 'related')]);
    expect([...(index.neighbors.get('a') ?? [])]).toEqual(['b']);
  });
});

describe('clampHops', () => {
  it('把越界值夹回合法区间', () => {
    expect(clampHops(-3)).toBe(0);
    expect(clampHops(0)).toBe(0);
    expect(clampHops(2)).toBe(2);
    expect(clampHops(99)).toBe(MAX_HOPS);
  });

  it('截断小数', () => {
    expect(clampHops(2.9)).toBe(2);
  });

  it('非有限数回落到默认两跳，而不是 NaN', () => {
    expect(clampHops(Number.NaN)).toBe(2);
    expect(clampHops(Number.POSITIVE_INFINITY)).toBe(2);
  });
});

describe('neighborhood', () => {
  const index = buildGraphIndex(CHAIN_NODES, CHAIN_EDGES);

  it('0 跳只有焦点自己', () => {
    expect(neighborhood(index, 'b', 0)).toEqual(new Set(['b']));
  });

  it('1 跳含直接的先修与后继', () => {
    // b 的 1 跳：前置 a、后继 c 与 e
    expect(neighborhood(index, 'b', 1)).toEqual(new Set(['b', 'a', 'c', 'e']));
  });

  it('2 跳沿链再走一步', () => {
    // 从 b 出发 2 跳：a/c/e 之后还能到 d（c 的后继）
    expect(neighborhood(index, 'b', 2)).toEqual(new Set(['b', 'a', 'c', 'e', 'd']));
  });

  it('跳数增加是单调的 —— 子集关系必须成立', () => {
    const one = neighborhood(index, 'c', 1);
    const two = neighborhood(index, 'c', 2);
    const three = neighborhood(index, 'c', 3);
    expect([...one].every((id) => two.has(id))).toBe(true);
    expect([...two].every((id) => three.has(id))).toBe(true);
  });

  it('孤立节点在任何跳数下都只有自己', () => {
    expect(neighborhood(index, 'x', 1)).toEqual(new Set(['x']));
    expect(neighborhood(index, 'x', MAX_HOPS)).toEqual(new Set(['x']));
  });

  it('焦点不存在时返回空集，不抛错', () => {
    // URL 里的 ?focus= 可能指向已经删除的节点
    expect(neighborhood(index, 'ghost', 2).size).toBe(0);
    expect(neighborhood(index, null, 2).size).toBe(0);
  });

  it('超大跳数不会死循环，收敛到整个连通分量', () => {
    expect(neighborhood(index, 'b', 999)).toEqual(new Set(['a', 'b', 'c', 'd', 'e']));
  });
});

describe('visibleSubgraph', () => {
  const index = buildGraphIndex(CHAIN_NODES, CHAIN_EDGES);

  it('hops=null 表示全图', () => {
    const sub = visibleSubgraph(index, null, null);
    expect(sub.nodes).toHaveLength(CHAIN_NODES.length);
    expect(sub.edges).toHaveLength(CHAIN_EDGES.length);
    expect(sub.focusVisible).toBe(false);
  });

  it('只留两端都可见的边 —— 不能出现悬空端点', () => {
    const sub = visibleSubgraph(index, 'b', 1);
    const ids = new Set(sub.nodes.map((n) => n.microKpId));
    // b 的 1 跳是 a/b/c/e，c→d 这条边的 d 不可见，必须被裁掉
    expect(sub.edges.map((e) => `${e.from}->${e.to}`).sort()).toEqual([
      'a->b',
      'b->c',
      'b->e',
    ]);
    for (const e of sub.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });

  it('焦点在可见集里时 focusVisible 为 true', () => {
    expect(visibleSubgraph(index, 'b', 2).focusVisible).toBe(true);
  });

  it('焦点不存在时 focusVisible 为 false 且节点为空', () => {
    const sub = visibleSubgraph(index, 'ghost', 2);
    expect(sub.nodes).toHaveLength(0);
    expect(sub.focusVisible).toBe(false);
  });
});

describe('orderMainline', () => {
  it('按 模块序 → 树深 → 模块内序 → id 排序', () => {
    const nodes = [
      node('z', { moduleOrdinal: 2, depth: 1, ordinal: 1 }),
      node('y', { moduleOrdinal: 1, depth: 2, ordinal: 1 }),
      node('x', { moduleOrdinal: 1, depth: 1, ordinal: 5 }),
      node('w', { moduleOrdinal: 1, depth: 1, ordinal: 2 }),
    ];
    expect(orderMainline(nodes).map((n) => n.microKpId)).toEqual(['w', 'x', 'y', 'z']);
  });

  it('模块序相同的两个模块靠 moduleId 断开，顺序稳定可复现', () => {
    // 真实数据里 m-digital 与 mod-digital-kanghua-5e-kp-1 的 ordinal 都是 1
    const nodes = [
      node('b1', { moduleId: 'm-digital', moduleOrdinal: 1, depth: 1, ordinal: 1 }),
      node('a1', { moduleId: 'mod-kp-1', moduleOrdinal: 1, depth: 1, ordinal: 1 }),
    ];
    const first = orderMainline(nodes).map((n) => n.microKpId);
    const second = orderMainline([...nodes].reverse()).map((n) => n.microKpId);
    expect(first).toEqual(second);
    expect(first).toEqual(['b1', 'a1']);
  });

  it('不修改入参', () => {
    const nodes = [node('b', { ordinal: 2 }), node('a', { ordinal: 1 })];
    const snapshot = nodes.map((n) => n.microKpId);
    orderMainline(nodes);
    expect(nodes.map((n) => n.microKpId)).toEqual(snapshot);
  });

  it('全序：任意两个节点的相对顺序都确定', () => {
    const nodes = [
      node('a', { ordinal: 1 }),
      node('b', { ordinal: 1 }),
      node('c', { ordinal: 1 }),
    ];
    // ordinal 全相同时靠 id 定序，结果唯一
    expect(orderMainline(nodes).map((n) => n.microKpId)).toEqual(['a', 'b', 'c']);
  });
});

describe('groupMainline', () => {
  it('按模块分组且保持排序', () => {
    const nodes = [
      node('b', { moduleId: 'm-b', moduleName: '乙模块', moduleOrdinal: 2 }),
      node('a', { moduleId: 'm-a', moduleName: '甲模块', moduleOrdinal: 1 }),
      node('a2', { moduleId: 'm-a', moduleName: '甲模块', moduleOrdinal: 1, ordinal: 2 }),
    ];
    const sections = groupMainline(nodes);
    expect(sections.map((s) => s.moduleName)).toEqual(['甲模块', '乙模块']);
    expect(sections[0]?.nodes.map((n) => n.microKpId)).toEqual(['a', 'a2']);
  });
});

describe('mainlineIndexOf / mainlineNeighbors', () => {
  const nodes = [
    node('c', { moduleOrdinal: 1, depth: 1, ordinal: 3 }),
    node('a', { moduleOrdinal: 1, depth: 1, ordinal: 1 }),
    node('b', { moduleOrdinal: 1, depth: 1, ordinal: 2 }),
  ];

  it('返回焦点在主线里的序号', () => {
    expect(mainlineIndexOf(nodes, 'b')).toBe(1);
  });

  it('找不到时返回 -1', () => {
    expect(mainlineIndexOf(nodes, 'ghost')).toBe(-1);
    expect(mainlineIndexOf(nodes, null)).toBe(-1);
  });

  it('给出前后节点，边界处为 null', () => {
    expect(mainlineNeighbors(nodes, 'a')).toEqual({
      previous: null,
      next: expect.objectContaining({ microKpId: 'b' }),
    });
    expect(mainlineNeighbors(nodes, 'b').next?.microKpId).toBe('c');
    expect(mainlineNeighbors(nodes, 'c').next).toBeNull();
  });

  it('焦点不存在时前后都为 null', () => {
    expect(mainlineNeighbors(nodes, 'ghost')).toEqual({ previous: null, next: null });
  });
});
