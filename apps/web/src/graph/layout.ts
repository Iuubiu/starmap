/**
 * 力导向布局：把契约数据变成 graphology 图，并把物理解算交给 Web Worker。
 *
 * ## 票 03 第 1 条为什么不能用 `forceAtlas2.assign()`
 *
 * 同步版的 `assign` 会在**主线程**上跑完整轮迭代。167 个节点还好，2000 个
 * 节点就是几百毫秒到数秒的完全冻结 —— 拖动、缩放、点击全部无响应，而这恰
 * 恰是「拖动缩放仍可交互」要禁止的。用户对卡顿的容忍度在 100ms 量级，超出
 * 之后画布就只是张图片。
 *
 * `graphology-layout-forceatlas2/worker` 的 `FA2LayoutSupervisor` 把迭代放进
 * 一个真 Worker（内部 `new Blob([...]) + createObjectURL`，不依赖打包器处理
 * worker 入口，所以 Vite 下直接可用），主线程只接收算好的坐标。这样物理计算
 * 与渲染/输入并行。
 *
 * ## 为什么初始位置是圆
 *
 * FA2 从随机初始位置出发，同一份数据两次运行会得到不同结果 —— 用户刷新页面
 * 会发现图「动了」，而且「我记得那个节点在左下角」这种空间记忆直接报废。
 * 用确定性圆环做种子，至少让无连接节点（真实数据里 109/167）稳定在外圈，
 * 而有连接的节点会被力导向拉成团。圆环也让第一次渲染立刻有东西看，不必等
 * 几轮迭代。
 */
import Graph from 'graphology';
import FA2LayoutSupervisor from 'graphology-layout-forceatlas2/worker';
import type { GraphEdge, GraphNode } from '../api/generated/model';

/** 图的节点属性：坐标 + 画布需要的几个字段。 */
export interface LayoutNodeAttributes {
  x: number;
  y: number;
  /** 显示用标签（节点名） */
  label: string;
  /** 基础尺寸，sigma 的 size 属性 */
  size: number;
}

/** 图的边属性。目前只需要渲染权重，先留空但显式声明以便将来扩展。 */
export type LayoutEdgeAttributes = Record<string, never>;

export type LayoutGraph = Graph<LayoutNodeAttributes, LayoutEdgeAttributes>;

/** 圆环种子的半径。与节点数无关的固定值即可 —— FA2 会重新排。 */
const SEED_RADIUS = 1;

/**
 * 确定性初始位置：等角分布在单位圆上。
 *
 * 从 12 点方向起顺时针排列，`i / n * 2π`。n=1 时放在圆心（避免除零，也让
 * 孤立单节点看起来不像「跑到边上去了」）。
 */
export function seedPositions(count: number): Array<{ x: number; y: number }> {
  if (count <= 1) return Array.from({ length: count }, () => ({ x: 0, y: 0 }));
  const positions: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    positions.push({ x: Math.cos(angle) * SEED_RADIUS, y: Math.sin(angle) * SEED_RADIUS });
  }
  return positions;
}

/**
 * 建图。节点与边都按入参顺序加入，坐标用圆环种子。
 *
 * 边只保留两端都在节点集里的（与拓扑层的裁剪一致）—— graphology 对不存在
 * 的端点会直接抛错，而图谱接口不保证这个不变量。
 */
export function buildLayoutGraph(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): LayoutGraph {
  const graph = new Graph<LayoutNodeAttributes, LayoutEdgeAttributes>({ multi: false, type: 'directed' });
  const positions = seedPositions(nodes.length);

  nodes.forEach((node, index) => {
    const position = positions[index] ?? { x: 0, y: 0 };
    graph.addNode(node.microKpId, {
      x: position.x,
      y: position.y,
      label: node.name,
      size: 6,
    });
  });

  for (const edge of edges) {
    if (!graph.hasNode(edge.from) || !graph.hasNode(edge.to)) continue;
    // multi:false + 同一对节点可能有多条不同类型的边（prereq 与 related）
    if (graph.hasEdge(edge.from, edge.to)) continue;
    graph.addEdge(edge.from, edge.to);
  }

  return graph;
}

/**
 * 把图里的坐标读出来成 sigma 能用的形式。
 *
 * sigma 直接从 graphology 的节点属性读 `x`/`y`，所以其实不需要这层 —— 但
 * Worker 每轮把坐标写回属性之后，主线程需要知道「布局推进了多少」来判断
 * 是否还在动（e2e 与新节点加入时都要等布局收敛）。这里给一个便宜的指纹。
 */
export function positionFingerprint(graph: LayoutGraph): number {
  let sum = 0;
  graph.forEachNode((key) => {
    const attributes = graph.getNodeAttributes(key);
    sum += attributes.x * 31 + attributes.y * 17;
  });
  return sum;
}

export interface LayoutHandle {
  /** 是否真的跑在 Worker 里（false = 降级为静态布局） */
  readonly usesWorker: boolean;
  /** 停掉解算并释放资源；可重复调用 */
  stop(): void;
  /**
   * 停止**继续收敛**，但保留 worker 与句柄以便重新启动。
   *
   * 与 `stop()` 的区别只在生命周期：`stop()` 是销毁（`kill()` 之后不可再
   * `start()`），本方法是「这一轮排布就到这儿」—— 画布已经能看，继续迭代
   * 只是像素级微调，却会让主线程持续承担坐标写回的重索引成本。
   *
   * 见 `GraphCanvas.tsx` 里 `LAYOUT_BUDGET_MS` 的注释：不设预算时，2000 节点
   * 的收敛期会持续产出 70–200ms 的长任务。
   */
  stopConverging(): void;
  /** 当前坐标指纹，用于判断布局是否还在收敛 */
  fingerprint(): number;
  /** 底层图对象（sigma 构造需要） */
  readonly graph: LayoutGraph;
}

/**
 * 启动力导向布局。
 *
 * 参数挑选的理由：
 * - `barnesHutOptimize: true` + `barnesHutTheta: 0.5`：2000+ 节点时把 O(n²)
 *   的斥力降到 O(n log n)。167 个节点时它没有坏处（只是多一层树），所以
 *   不必按节点数分叉。
 * - `scalingRatio: 10`：默认 1 会把节点挤成一团点 —— FA2 的 scalingRatio
 *   是斥力强度，深色画布上需要更大的间距才看得清形状。
 * - `slowDown: 2`：默认 1 时反复迭代会持续抖动；放慢一点让布局更快稳定，
 *   用户也就不必盯着一直变的画布。
 * - `gravity: 0.5`：比默认 1 弱一些，让连通分量之间保留距离（真实数据里
 *   有 124 个连通分量，粘在一起就成了一坨）。
 *
 * `typeof Worker === 'undefined'` 时（jsdom / SSR）不启动 Worker，直接返回
 * 一个静态句柄：圆环种子已经是可用的布局，画布能画出来，只是不会自动排布。
 * 这样组件测试不必 mock 一整个 Worker 实现，而真实浏览器里走的是真 Worker。
 */
export function startLayout(graph: LayoutGraph): LayoutHandle {
  if (typeof Worker === 'undefined') {
    return {
      usesWorker: false,
      stop: () => {
        /* 无 Worker 可停 */
      },
      stopConverging: () => {
        /* 本来就没在算 */
      },
      fingerprint: () => positionFingerprint(graph),
      graph,
    };
  }

  let supervisor: FA2LayoutSupervisor | null = null;
  try {
    supervisor = new FA2LayoutSupervisor(graph, {
      settings: {
        barnesHutOptimize: true,
        barnesHutTheta: 0.5,
        scalingRatio: 10,
        slowDown: 2,
        gravity: 0.5,
      },
    });
    supervisor.start();
  } catch {
    // Worker 不可用（CSP 禁 blob:、隐私模式等）时降级：圆环种子布局仍然可看。
    // 静默失败比白屏好 —— 票 03 的性能要求是「不阻塞主线程」，降级后确实
    // 不阻塞（因为根本没算），只是没有力导向的美感。
    supervisor?.kill();
    supervisor = null;
  }

  let stopped = false;
  return {
    usesWorker: supervisor !== null,
    stop: () => {
      if (stopped) return;
      stopped = true;
      // kill() 之后不能再 start()，所以句柄也不该被复用
      supervisor?.kill();
      supervisor = null;
    },
    stopConverging: () => {
      // stop() 只是停下「问下一轮」，worker 与矩阵都还在，可再 start()
      supervisor?.stop();
    },
    fingerprint: () => positionFingerprint(graph),
    graph,
  };
}
