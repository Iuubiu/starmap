/**
 * 图谱的拓扑层：邻接表、两跳邻域裁剪、主线排序。
 *
 * 这里全是纯函数，没有 DOM、没有 sigma、没有 React —— 所以能被 vitest 直接
 * 覆盖（`*.test.ts` 与文件同目录）。画布只在拿到这些结果之后负责画。
 *
 * 这个分工是刻意的：**「该显示哪些节点」是业务规则，「怎么画」是渲染细节**。
 * 混在一起的话，两张视图（图谱 / 主线）就得各写一份可达性逻辑，然后慢慢
 * 漂移成两个不一致的答案。
 */
import type { GraphEdge, GraphNode } from '../api/generated/model';

/** 一张规范化的图：节点按 id 索引，边保留原始方向。 */
export interface GraphIndex {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  byId: Map<string, GraphNode>;
  /** 无向邻接：邻居集合。先修关系对学习者是双向的（见下），所以合并两个方向。 */
  neighbors: Map<string, Set<string>>;
  /** 后继（本节点的「学完能解锁什么」）。 */
  outgoing: Map<string, Set<string>>;
  /** 前置（本节点的「得先学什么」）。 */
  incoming: Map<string, Set<string>>;
  /** 模块 → 该模块下的微知识点。用于「同章展开」与主线分组。 */
  byModule: Map<string, string[]>;
}

/**
 * 为什么邻接是**无向**的。
 *
 * `kp_edges` 是 `from → to`（from 是先修）。但站在画布前面的人关心的是
 * 「跟我有关的节点」：既包括我得先学的（incoming），也包括学完能解锁的
 * （outgoing）。只沿一个方向展开会让图谱从「局部一团」变成「一条朝后的
 * 射线」——一路只看到祖先，看不到任何后继，而后续内容恰恰是学习者最想看
 * 的部分。
 *
 * 更实际的理由：真实数据里 167 个叶节点只有 52 条边，且**每个节点平均不到
 * 1 条边**、109 个孤立点。只沿一个方向走，两跳邻域会退化成 1 个节点的
 * 尴尬人数（`kp-bool` 就是这种孤立节点）。无向合并至少让「有邻居的节点」
 * 展开出它真实的邻里。方向信息没有被丢掉——它留在 `outgoing` / `incoming`
 * 里，画布上能据此区分「先修」与「后继」。
 *
 * ## 为什么同模块**不**折成邻接
 *
 * 一个诱人的想法是把「同模块」也当成一条边（它们共享父节点，图上距离本来就是
 * 2），这样孤立节点聚焦时也能看到整章。但那样会让跳数失去意义：最大的模块有
 * 27 个微知识点，同模块成团之后 **1 跳 = 整章**，于是「+1 跳 / −1 跳」退化成
 * 「1 跳 = 一章，2 跳 = 全图」。票 03 第 2 条要的是逐层展开，不是三个档位。
 *
 * 所以「整章」是一个**独立操作**（`chapterNodes`），有自己的按钮与自己的
 * 语义，不混进跳数。这样两件事都成立：跳数是诚实的拓扑距离，而孤立节点
 * 也有一条明确的出路。
 */
export function buildGraphIndex(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): GraphIndex {
  const byId = new Map<string, GraphNode>();
  const neighbors = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  const byModule = new Map<string, string[]>();

  for (const node of nodes) {
    byId.set(node.microKpId, node);
    neighbors.set(node.microKpId, new Set());
    outgoing.set(node.microKpId, new Set());
    incoming.set(node.microKpId, new Set());
    const bucket = byModule.get(node.moduleId);
    if (bucket) bucket.push(node.microKpId);
    else byModule.set(node.moduleId, [node.microKpId]);
  }

  // 只保留两端都在节点集里的边。真实数据里 52 条边都是 leaf→leaf，但迁移
  // 允许 prereq 指向非叶节点（`kp_edges` 没有限定 is_leaf），而图谱接口只
  // 返回叶节点 —— 于是「指向非叶节点的先修边」会在这里被安静地丢掉。这是
  // 正确行为（画布上没有那个节点），但值得写下来，否则将来有人对不上数。
  for (const edge of edges) {
    const from = neighbors.get(edge.from);
    const to = neighbors.get(edge.to);
    if (!from || !to) continue;
    from.add(edge.to);
    to.add(edge.from);
    outgoing.get(edge.from)?.add(edge.to);
    incoming.get(edge.to)?.add(edge.from);
  }

  return { nodes, edges, byId, neighbors, outgoing, incoming, byModule };
}

/** 跳数上限。开方级增长：2000 个节点的图最多 6 跳，再多就等于全图了。 */
export const MAX_HOPS = 6;

/** 默认的两跳（票 03 第 2 条）。 */
export const DEFAULT_HOPS = 2;

/**
 * 把任意输入夹到 `[0, MAX_HOPS]`。
 *
 * `0` 是合法的（只看焦点自己），用于「收起」到最紧的视野；URL 里手写的
 * `-3` / `99` / `abc` 都会落到合理值上，而不是让画布空掉或炸掉。
 */
export function clampHops(hops: number): number {
  if (!Number.isFinite(hops)) return DEFAULT_HOPS;
  return Math.min(MAX_HOPS, Math.max(0, Math.trunc(hops)));
}

/**
 * 焦点节点 `focusId` 的 `hops` 跳邻域（**含焦点自身**）。
 *
 * 用 BFS 而不是 DFS：BFS 的层数正好就是跳数，天然是「两跳以内」的正确
 * 语义；DFS 要额外记录最短距离，容易写出「看起来对但会绕过更短路径」的版本。
 *
 * 焦点不存在时返回空集，而不是抛错：URL 里的 `?focus=` 可能来自一个已经被
 * 删掉的节点（或手写的乱值），此时合理的行为是「没有焦点」——上层据此退回
 * 全图，而不是白屏。
 */
export function neighborhood(
  index: GraphIndex,
  focusId: string | null,
  hops: number,
): Set<string> {
  const visible = new Set<string>();
  if (focusId === null || !index.byId.has(focusId)) return visible;

  const limit = clampHops(hops);
  visible.add(focusId);

  let frontier: string[] = [focusId];
  for (let depth = 0; depth < limit; depth += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of index.neighbors.get(id) ?? []) {
        if (visible.has(neighbor)) continue;
        visible.add(neighbor);
        next.push(neighbor);
      }
    }
    if (next.length === 0) break; // 孤立节点：提前收敛，别空转
    frontier = next;
  }
  return visible;
}

/**
 * 当前应该画出来的子集：`visibleNodes` 为 null 表示「全图」。
 *
 * 返回的是**边也被裁过**的图：两端都可见的边才画。只裁节点会让边的端点
 * 悬空，sigma 会去 `graph.getNodeAttributes(undefined)` 上炸掉。
 */
export interface VisibleSubgraph {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  /** 焦点是否落在可见集里（可能在 URL 里但节点已不存在） */
  focusVisible: boolean;
}

export function visibleSubgraph(
  index: GraphIndex,
  focusId: string | null,
  hops: number | null,
): VisibleSubgraph {
  const visible = hops === null ? null : neighborhood(index, focusId, hops);
  const nodes = visible === null ? index.nodes : index.nodes.filter((n) => visible.has(n.microKpId));
  const edges =
    visible === null
      ? index.edges
      : index.edges.filter((e) => visible.has(e.from) && visible.has(e.to));

  return {
    nodes,
    edges,
    focusVisible: focusId !== null && nodes.some((n) => n.microKpId === focusId),
  };
}

/**
 * 线性主线的排序：模块序 → 树深 → 模块内序 → id。
 *
 * 这是图谱的「退路」（spec 第 27 行：保留线性主线）。顺序必须**全序**、
 * 且不依赖输入顺序，否则每次重新取数页面都会重排，用户会觉得图在乱跳。
 *
 * 真实数据里有个坑：`m-digital`（数字逻辑基础）与 `mod-digital-kanghua-5e-kp-1`
 * （数字逻辑概论）的 `ordinal` 都是 1 —— 只按 ordinal 排会出现两批交错。
 * 所以末位必须补 `id` 做 tie-break，让顺序稳定可复现。
 */
export function orderMainline(nodes: readonly GraphNode[]): GraphNode[] {
  return [...nodes].sort((a, b) => {
    if (a.moduleOrdinal !== b.moduleOrdinal) return a.moduleOrdinal - b.moduleOrdinal;
    if (a.moduleId !== b.moduleId) return a.moduleId < b.moduleId ? -1 : 1;
    if (a.depth !== b.depth) return a.depth - b.depth;
    if (a.ordinal !== b.ordinal) return a.ordinal - b.ordinal;
    return a.microKpId < b.microKpId ? -1 : a.microKpId > b.microKpId ? 1 : 0;
  });
}

/** 主线里按模块分组（保持 `orderMainline` 的顺序，只在模块切换时开新组）。 */
export interface MainlineSection {
  moduleId: string;
  moduleName: string;
  nodes: GraphNode[];
}

export function groupMainline(nodes: readonly GraphNode[]): MainlineSection[] {
  const sections: MainlineSection[] = [];
  for (const node of orderMainline(nodes)) {
    const last = sections.at(-1);
    if (last && last.moduleId === node.moduleId) {
      last.nodes.push(node);
    } else {
      sections.push({ moduleId: node.moduleId, moduleName: node.moduleName, nodes: [node] });
    }
  }
  return sections;
}

/**
 * 焦点在主线里的位置（index 与所在分组），用于「切到主线时把当前位置带过去」。
 *
 * 找不到时返回 -1 —— 调用方据此退回第一个节点，而不是抛错。
 */
export function mainlineIndexOf(nodes: readonly GraphNode[], focusId: string | null): number {
  if (focusId === null) return -1;
  return orderMainline(nodes).findIndex((n) => n.microKpId === focusId);
}

/**
 * 主线里的前后邻居（用于上下关切换）。
 *
 * 主线是线性的，所以「下一个待学」就是排序里的下一条，不需要图搜索。
 * 到边界时返回 null，调用方据此禁用按钮。
 */
export function mainlineNeighbors(
  nodes: readonly GraphNode[],
  focusId: string | null,
): { previous: GraphNode | null; next: GraphNode | null } {
  const ordered = orderMainline(nodes);
  const index = mainlineIndexOf(ordered, focusId);
  if (index < 0) return { previous: null, next: null };
  return {
    previous: ordered[index - 1] ?? null,
    next: ordered[index + 1] ?? null,
  };
}
