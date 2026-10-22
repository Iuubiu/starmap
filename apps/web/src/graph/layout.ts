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
 * ## 为什么初始位置是确定性的向日葵盘，不是圆环
 *
 * FA2 从随机初始位置出发，同一份数据两次运行会得到不同结果 —— 用户刷新页面
 * 会发现图「动了」，而且「我记得那个节点在左下角」这种空间记忆直接报废。
 * 所以种子必须确定性。
 *
 * 但「确定性」不等于「随便一个确定形状」。这里原来用的是**单位圆环**
 * （等角排布在 r=1 的圆周上），在 167 个节点时代看不出问题；到 5495 个节点
 * （真实 `/api/v1/graph`：5495 节点 / 241 条去重边 / 5173 个孤立点）就塌了：
 *
 * - 圆周长固定 2π，5495 个点挤在上面，相邻种子间距只有 `2π/5495 ≈ 0.0011`，
 *   而 sigma 把布局外接矩形等比 fit 进 860×480 的视口 → 投影后最近邻间距
 *   **0.25px**（实测 `.t44` 探针：`SEED ring (0 iters) nnMedian 0.25px`）。
 *   也就是第一次渲染还没跑布局时，整张图是**一条亮线**。
 * - 更糟的是 FA2 从这条线出发，斥力只沿线的法向展开，收敛后仍是一个**空心
 *   圆环**：径向密度剖面 10 等分 = `0.003 0.063 0.095 0.116 0.137 0.165
 *   0.194 0.183 0.045 0`（理想实心盘应该从 ~0.01 单调升到 ~0.19），中心
 *   一片空白 —— 这就是用户看到的「甜甜圈」。
 *
 * 换成**向日葵盘**（sunflower / 黄金角螺旋，`r = √((i+0.5)/n)`）后：面积与点数
 * 成正比、点密度天然均匀，投影后最近邻中位数 4.79px，跑完布局 4.31px，径向
 * 剖面 `0.070 0.096 0.118 0.120 0.133 0.143 0.167 0.152 0.003 0`（实心盘，
 * 中心空洞消失）。它同样是纯确定性的（黄金角是常数），空间记忆照样保住。
 *
 * 顺带一提：孤立点在 FA2 里**也会动**（斥力对它们照样生效，实测 5173 个
 * 孤立点全部有位移，最大 3.3e+3），所以「种子只影响第一帧」是错的 —— 种子
 * 的形状会决定收敛后的整体拓扑。
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

/**
 * `nodeDiameter(n) = clamp(K / √n, MIN, MAX)` 的三个常数。
 *
 * ## 为什么要随节点数缩放
 *
 * 画布原来给每个节点写死 7–9 像素。167 个节点时没问题；真实
 * `/api/v1/graph` 是 5495 个节点，全画在 860×480 的画布上，5495 个 7px 圆的
 * 面积是画布可用区（去掉 40px 边距后 780×400）的 **68%** —— 物理上必然互相
 * 覆盖，画布变成一整块亮斑，任何节点都认不出来。可分辨度实测：5495 节点下
 * 直径 9px 时只有 2.6% 的节点不与邻居重叠，5px 时 44%，3.26px 时 98%
 * （`apps/web/probe-t44-matrix.mjs` 同源度量）。
 *
 * ## K 怎么来的
 *
 * 在 6 种规模（真实 5495 + 合成 3000/1200/500/200/60）上跑「向日葵盘种子 +
 * `scalingRatio: 4` / `gravity: 1`」，量每个节点到最近邻的屏幕距离，取 P10
 * 分位（最密的 10% 之外都算可分）。拟合 `P10 ≈ K/√n` 得
 * `K = 241.3 / 252.2 / 247.8 / 235.2 / 162.9 / 204.3`，中位数 **241.3**。
 *
 * 取 `diameter = P10` 的含义：**只有最密的 10% 会重叠**（即 separable ≈ 90%）。
 * 实测校验：n=5495 → 3.26px，真图 P10 = 3.31px；n=1200 → 6.97px，实测 7.15px。
 *
 * ## 上下限
 *
 * - `MAX = 9`：节点很少时不要把点画成巨人（200 节点算出来 17px，钳到 9）。
 *   这也是旧的 `review: 9` 上界，视觉上与 167 节点时代一致。
 * - `MIN = 2`：再小就不可点击了。5495 节点算出来 3.26px，离下限还有距离；
 *   但若将来图谱规模再涨一个量级（2 万节点 → 1.7px），就靠这条保住下限，
 *   同时配合画布层的 `nodePickingPadding` 把命中区撑开。
 *
 * 放在 layout 层而不是渲染层：这个值的依据是**布局跑完之后节点之间的实际
 * 间距**，不是配色或形状那种纯视觉参数。渲染层只是把它当作 sigma 的 `size`
 * （`itemSizesReference: 'screen'` 下就是屏幕像素）。
 *
 * 可复现：`node apps/web/.t44-testcal.mjs`、`node apps/web/.t44-real2.mjs`。
 */
const NODE_DIAMETER_K = 241.3;
const NODE_DIAMETER_MIN = 2;
const NODE_DIAMETER_MAX = 9;

/**
 * 给定节点数，返回画布上单个节点的目标直径（CSS 像素）。
 */
export function nodeDiameter(count: number): number {
  const k = NODE_DIAMETER_K / Math.sqrt(Math.max(1, count));
  return Math.max(NODE_DIAMETER_MIN, Math.min(NODE_DIAMETER_MAX, k));
}

/**
 * 黄金角 `2π(1 - 1/φ)`。向日葵盘用这个角度逐点旋转，任意前缀都均匀铺满圆盘。
 *
 * 与 `i / n * 2π`（等角）的区别：等角排布在**同一半径**上，点数一多就挤成
 * 一圈；黄金角配合 `√(i/n)` 的半径，把点摊到整个盘面上，密度处处相同。
 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * 确定性初始位置：向日葵盘（黄金角螺旋）。
 *
 * 第 i 个点的极坐标是 `r = √((i + 0.5) / n)`、`θ = i · 黄金角`，即
 * `x = r·cosθ`、`y = r·sinθ`。取 `i + 0.5` 而不是 `i` 是为了让 n 个点落在
 * 各自环带的**中心**，n 大时首尾不会都贴着圆心。
 *
 * 为什么半径要开根号：盘面积是 `πr²`，第 i 个点应该占 `(i+0.5)/n` 的面积
 * 份额，反解 `r` 就是 `√((i+0.5)/n)`。这样无论 n 是 5 还是 5000，相邻点的
 * 间距都只与 `1/√n` 有关，不会出现「圆环种子里 5495 个点间距 0.0011」那种
 * 退化。
 *
 * n=1 时放在圆心（避免除零，也让孤立单节点看起来不像「跑到边上去了」）。
 */
export function seedPositions(count: number): Array<{ x: number; y: number }> {
  if (count <= 1) return Array.from({ length: count }, () => ({ x: 0, y: 0 }));
  const positions: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const radius = Math.sqrt((i + 0.5) / count);
    const angle = i * GOLDEN_ANGLE;
    positions.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  return positions;
}

/**
 * 建图。节点与边都按入参顺序加入，坐标用向日葵盘种子。
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
 * 力导向的生产参数。**导出**是为了让回归测试能用同一份值复算可分辨度 ——
 * 测试不直接断言这几个数字（那是常量快照，改对了也会红），而是拿它跑出布局
 * 再量「投影后有多少节点不与邻居重叠」。
 *
 * 参数挑选的理由（都在真实 `/api/v1/graph` 快照上量过：5495 节点 / 241 条
 * 去重边 / 5173 个孤立点；探针脚本 `apps/web/.t44-decide2.mjs`、
 * `.t44-conv.mjs`、`.t44-real2.mjs`，可复跑）：
 *
 * - `barnesHutOptimize: true` + `barnesHutTheta: 0.5`：2000+ 节点时把 O(n²)
 *   的斥力降到 O(n log n)。小图上它没有坏处（只是多一层树），所以不必按
 *   节点数分叉。
 * - `scalingRatio: 4`：FA2 的 scalingRatio 是斥力强度。原来的 10 是 167 节点
 *   时代调的，在 5495 节点上会把布局撑到坐标跨度 10951 —— 而 sigma 是**等比
 *   fit** 进视口的，跨度大只意味着点更密、不是更大。实测同一（盘状）种子下
 *   `sr=4/grav=1` 的可分辨节点占比 90.7%，`sr=10/grav=0.5` 是 90.3% —— 在
 *   5495 节点这个规模上两者几乎无差（瓶颈是直径，不是斥力）；差距体现在小
 *   图上：1200 节点时 87.2% vs 73.8%（+13pp），500 节点时 75.6% vs 64.6%。
 *   取 4 是因为它在各个规模上都不劣于 10，且跨度只有一半（4604 vs 7845）。
 * - `gravity: 1`：默认值。原来的 0.5 太弱，5173 个孤立点被斥力推到外圈、中心
 *   空掉；`gravity: 0` 更糟（跨度涨到 6615，且没有簇心，看起来像均匀噪点）。
 *   实测 `disk sr4 grav1` 的径向均匀度 L1 = 0.541，是全部 17 组候选里最好的。
 * - `slowDown: 2`：默认 1 时反复迭代会持续抖动；放慢一点让布局更快稳定，
 *   用户也就不必盯着一直变的画布。
 *
 * 还有一条不在参数里、但同样重要的：**迭代轮数越少越好**。FA2 会把点往连通
 * 分量上聚，实测 100 轮 79.1% → 200 轮 71.2% → 400 轮 64.1% → 800 轮 62.5%
 * 可分辨。正好 `GraphCanvas.tsx` 的 `LAYOUT_BUDGET_MS` 预算（4s）会在 150–200
 * 轮附近就 `stopConverging()`，两者一致，不必改预算。
 */
export const FA2_SETTINGS = {
  barnesHutOptimize: true,
  barnesHutTheta: 0.5,
  scalingRatio: 4,
  slowDown: 2,
  gravity: 1,
} as const;

/**
 * 启动力导向布局。
 *
 * 参数挑选的理由（都在真实 `/api/v1/graph` 快照上量过：5495 节点 / 241 条
 * 去重边 / 5173 个孤立点；探针脚本 `apps/web/.t44-decide2.mjs`、
 * `.t44-conv.mjs`，可复跑）：
 *
 * - `barnesHutOptimize: true` + `barnesHutTheta: 0.5`：2000+ 节点时把 O(n²)
 *   的斥力降到 O(n log n)。小图上它没有坏处（只是多一层树），所以不必按
 *   节点数分叉。
 * - `scalingRatio: 4`：FA2 的 scalingRatio 是斥力强度。原来的 10 是 167 节点
 *   时代调的，在 5495 节点上会把布局撑到坐标跨度 10951 —— 而 sigma 是**等比
 *   fit** 进视口的，跨度大只意味着点更密、不是更大。实测同一直径下
 *   `sr=10/grav=0.5` 的可分辨节点占比 69.2%，`sr=4/grav=1` 是 88.3%（+19pp）。
 * - `gravity: 1`：默认值。原来的 0.5 太弱，5173 个孤立点被斥力推到外圈、中心
 *   空掉；`gravity: 0` 更糟（跨度涨到 6615，且没有簇心，看起来像均匀噪点）。
 *   实测 `disk sr4 grav1` 的径向均匀度 L1 = 0.541，是全部 17 组候选里最好的。
 * - `slowDown: 2`：默认 1 时反复迭代会持续抖动；放慢一点让布局更快稳定，
 *   用户也就不必盯着一直变的画布。
 *
 * 还有一条不在参数里、但同样重要的：**迭代轮数越少越好**。FA2 会把点往连通
 * 分量上聚，实测 100 轮 79.1% → 200 轮 71.2% → 400 轮 64.1% → 800 轮 62.5%
 * 可分辨。正好 `GraphCanvas.tsx` 的 `LAYOUT_BUDGET_MS` 预算（4s）会在 150–200
 * 轮附近就 `stopConverging()`，两者一致，不必改预算。
 *
 * `typeof Worker === 'undefined'` 时（jsdom / SSR）不启动 Worker，直接返回
 * 一个静态句柄：向日葵盘种子已经是可用的布局，画布能画出来，只是不会自动
 * 排布。
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
    supervisor = new FA2LayoutSupervisor(graph, { settings: { ...FA2_SETTINGS } });
    supervisor.start();
  } catch {
    // Worker 不可用（CSP 禁 blob:、隐私模式等）时降级：向日葵盘种子布局仍然可看。
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
