/**
 * 布局层单测：建图、种子形状、可观察结果（投影后的可分辨度）、Worker 降级路径。
 *
 * ## 为什么现在会测力导向的结果
 *
 * 以前这里写着「不测力导向的结果（FA2 是随机的）」。实测 FA2 是**确定性**的：
 * 同样的图、同样的种子、同样的参数跑两次，坐标完全一致（它没有随机源，
 * `graphology-layout-forceatlas2` 的 `assign` 是纯迭代）。所以可以断言结果。
 *
 * ## 断言的是什么
 *
 * 不是「参数等于 4/1」（那是常量快照，改对了也会红），而是**用户能看到的结果**：
 * 把布局坐标按 sigma 的等比 fit 规则投影到 860×480 的视口，用
 * `nodeDiameter(节点数)` 当「一个节点在屏幕上占多宽」，数有多少节点的最近邻
 * 距离不小于这个宽度 —— 即「有多少节点不与邻居粘成一团」。
 *
 * 真实布局与「不阻塞主线程」仍由 Playwright 断言（见 e2e/graph.spec.ts）。
 */
import { describe, expect, it } from 'vitest';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import type { GraphEdge, GraphNode } from '../api/generated/model';
import {
  buildLayoutGraph,
  FA2_SETTINGS,
  nodeDiameter,
  positionFingerprint,
  seedPositions,
  startLayout,
  type LayoutGraph,
} from './layout.js';

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

  it('铺满单位盘面 —— 半径开根号，不是都挤在圆边上', () => {
    // 旧实现是等角圆环（全部点半径 = 1）。5495 个点挤在一个圆上时相邻间距
    // 只有 2π/5495 ≈ 0.0011，投影到 860px 后是 0.23px —— 一整圈糊成一条线。
    const positions = seedPositions(4);
    for (const p of positions) {
      const r = Math.hypot(p.x, p.y);
      expect(r).toBeLessThanOrEqual(1);
    }
    // 4 个点的半径应该互不相同（各自占一条环带），而不是全部等于 1
    const radii = positions.map((p) => Math.hypot(p.x, p.y));
    expect(new Set(radii.map((r) => r.toFixed(6))).size).toBe(4);
    // 4 个点应该两两不同
    const keys = new Set(positions.map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`));
    expect(keys.size).toBe(4);
  });

  it('大面积下相邻点间距只与 1/√n 有关（不会退化成一条线）', () => {
    // 这是旧圆环种子的致命处：n 越大间距越小，5495 点时投影后 0.23px。
    const positions = seedPositions(2000);
    let minGap = Infinity;
    for (let i = 0; i < positions.length; i += 1) {
      const a = positions[i]!;
      for (let j = i + 1; j < positions.length; j += 1) {
        const b = positions[j]!;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < minGap) minGap = d;
      }
    }
    // 均匀盘的典型最近邻间距 ≈ 1/√n = 0.0224；开根号分布下不会远小于它
    expect(minGap).toBeGreaterThan(0.5 / Math.sqrt(2000));
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

describe('可观察结果：5495 节点规模下节点不能粘成一团', () => {
  // 票 03 的 P0：真实 `/api/v1/graph` 是 5495 个节点、279 条边（去重后 241），
  // 其中 5173 个是完全孤立的。这个用例用**与真实快照同形的合成拓扑**跑真实的
  // 生产参数，然后把坐标投影到 860×480 的视口，数「有多少节点的最近邻距离
  // 不小于它自己的直径」—— 即有多少节点是可分辨的。
  //
  // 实测（`apps/web/.t44-matrix.mjs`，3 个不同随机种子）：
  //   n=3000 盘状种子 + FA2_SETTINGS   separable = 89.7 / 89.7 / 89.1 %
  //   n=3000 圆环种子 + FA2_SETTINGS   separable = 61.8 / 60.2 / 61.7 %
  //   n=3000 盘状种子 + 旧参数(10/0.5) separable = 89.1 / 89.8 / 89.3 %
  //   n=3000 盘状种子 + 固定 7px      separable =  1.5 %
  // 取 0.75 作阈值：新实现留 14pp 余量，而**把种子改回圆环**或**把直径改回
  // 写死的 7px** 都会跌到阈值以下。
  //
  // 注意：改回旧 FA2 参数（scalingRatio:10 / gravity:0.5）**不会**让这条变红 ——
  // 实测两者在 1200/3000/5000 三个规模上的可分辨度相差 <2pp。真正决定可读性
  // 的是种子形状与直径，参数只影响坐标跨度（见 layout.ts 的 FA2_SETTINGS 注释）。
  const VIEW_W = 860;
  const VIEW_H = 480;
  const PAD = 40;

  /** 固定种子的线性同余发生器 —— 让合成拓扑可重现。 */
  function lcg(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  /**
   * 与真实快照同形的合成拓扑：5000 节点 / 275 条边 / 4678 个孤立点。
   *
   * 连通分量直方图取自真实快照（`{2:61, 3-5:29, 6-10:3, 11-20:3, >20:1}`），
   * 分量起点随机散布 —— 真实图的先修边跨越很多模块，不是集中在头部。
   */
  function syntheticGraph(count: number, edgeTarget: number): LayoutGraph {
    const graph = buildLayoutGraph(
      Array.from({ length: count }, (_, i) => node(`kp-${i}`)),
      [],
    );
    const random = lcg(20261022);
    const used = new Set<number>();
    const takeStart = (size: number): number | null => {
      for (let attempt = 0; attempt < 400; attempt += 1) {
        const start = Math.floor(random() * (count - size - 1));
        let free = true;
        for (let k = 0; k < size; k += 1) {
          if (used.has(start + k)) {
            free = false;
            break;
          }
        }
        if (free) {
          for (let k = 0; k < size; k += 1) used.add(start + k);
          return start;
        }
      }
      return null;
    };
    let made = 0;
    const chain = (size: number): void => {
      if (made >= edgeTarget) return;
      const start = takeStart(size);
      if (start === null) return;
      for (let k = 1; k < size && made < edgeTarget; k += 1) {
        graph.addEdge(`kp-${start + k - 1}`, `kp-${start + k}`);
        made += 1;
      }
    };
    const scale = count / 5000;
    for (let i = 0; i < Math.round(61 * scale); i += 1) chain(2);
    for (let i = 0; i < Math.round(29 * scale); i += 1) chain(4);
    for (let i = 0; i < Math.round(3 * scale); i += 1) chain(8);
    for (let i = 0; i < Math.round(3 * scale); i += 1) chain(15);
    chain(24);
    let guard = 0;
    while (made < edgeTarget && guard < 8000) {
      guard += 1;
      chain(2);
    }
    return graph;
  }

  /** 按 sigma 的等比 fit 规则把图坐标投影到视口像素。 */
  function project(graph: LayoutGraph): Array<{ x: number; y: number }> {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    graph.forEachNode((_, attributes: { x: number; y: number }) => {
      if (attributes.x < minX) minX = attributes.x;
      if (attributes.x > maxX) maxX = attributes.x;
      if (attributes.y < minY) minY = attributes.y;
      if (attributes.y > maxY) maxY = attributes.y;
    });
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const scale = Math.min((VIEW_W - 2 * PAD) / span, (VIEW_H - 2 * PAD) / span);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const points: Array<{ x: number; y: number }> = [];
    graph.forEachNode((_, attributes: { x: number; y: number }) => {
      points.push({
        x: VIEW_W / 2 + (attributes.x - cx) * scale,
        y: VIEW_H / 2 + (attributes.y - cy) * scale,
      });
    });
    return points;
  }

  /** 最近邻距离中位数与「可分辨」占比（最近邻 >= 直径），以及内圈节点占比。 */
  function readability(graph: LayoutGraph, diameter: number) {
    const points = project(graph);
    const n = points.length;
    const nearest = new Array<number>(n).fill(Infinity);
    for (let i = 0; i < n; i += 1) {
      const pi = points[i]!;
      for (let j = i + 1; j < n; j += 1) {
        const pj = points[j]!;
        const distance = Math.hypot(pi.x - pj.x, pi.y - pj.y);
        if (distance < nearest[i]!) nearest[i] = distance;
        if (distance < nearest[j]!) nearest[j] = distance;
      }
    }
    const separable = nearest.filter((value) => value >= diameter).length / n;
    // 内圈占比：理想均匀盘的「半径 30% 以内」应占 0.3² = 9% 的点。
    // 旧圆环种子全部点在同一条圆上，这个值恒为 0；甜甜圈状布局也很低。
    let cx = 0;
    let cy = 0;
    for (const point of points) {
      cx += point.x;
      cy += point.y;
    }
    cx /= n;
    cy /= n;
    let maxR = 0;
    const radii = points.map((point) => {
      const r = Math.hypot(point.x - cx, point.y - cy);
      if (r > maxR) maxR = r;
      return r;
    });
    const inner = radii.filter((r) => r <= 0.3 * maxR).length / n;
    return { separable, inner };
  }

  it('5000 节点跑完布局后，≥75% 的节点不与邻居粘连', () => {
    const count = 5000;
    const graph = syntheticGraph(count, 275);
    expect(graph.order).toBe(count);
    expect(graph.size).toBeGreaterThan(200);

    forceAtlas2.assign(graph, { iterations: 60, settings: { ...FA2_SETTINGS } });

    const diameter = nodeDiameter(count);
    // 直径必须随规模缩下来，否则 5000 个 7px 圆必然盖满画布（实测 sep 只有 0.2%）
    expect(diameter).toBeLessThan(7);
    expect(diameter).toBeGreaterThanOrEqual(2);

    const { separable, inner } = readability(graph, diameter);
    expect(separable).toBeGreaterThan(0.75);
    // 中心不能空（甜甜圈）：理想均匀盘是 9%，取 5% 作下限
    expect(inner).toBeGreaterThan(0.05);
  }, 30_000);

  it('节点数很小时直径不会被缩成看不见的点', () => {
    // 200 节点算出来 17px，被 MAX=9 钳住 —— 小图沿用 167 节点时代的手感
    expect(nodeDiameter(200)).toBe(9);
    expect(nodeDiameter(60)).toBe(9);
    expect(nodeDiameter(1200)).toBeGreaterThan(6);
    // 规模涨一个量级也不低于可点击下限
    expect(nodeDiameter(200_000)).toBe(2);
  });
});

describe('startLayout（jsdom 无 Worker 的降级路径）', () => {  it('没有 Worker 时不抛错，标记 usesWorker=false', () => {
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

  it('降级后坐标仍然是有限数（向日葵盘种子保证画得出来）', () => {
    const handle = startLayout(buildLayoutGraph([node('a'), node('b')], []));
    handle.graph.forEachNode((key) => {
      const attributes = handle.graph.getNodeAttributes(key);
      expect(Number.isFinite(attributes.x)).toBe(true);
      expect(Number.isFinite(attributes.y)).toBe(true);
    });
    handle.stop();
  });
});
