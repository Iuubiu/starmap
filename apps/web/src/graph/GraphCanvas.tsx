/**
 * 图谱画布：sigma + graphology 的 WebGL 渲染。
 *
 * ## 分工：画布负责「看」，页面负责「可访问」
 *
 * `<canvas>` 里的内容对辅助技术完全不可见 —— 没有节点、没有标签、没有 Tab
 * 顺序。硬塞进 canvas 的 `a11y hack`（叠加层、隐藏按钮）通常有三种结局：
 * 焦点环看不见、点击被相邻元素挡住、或者读屏念出一串没有位置的坐标。
 *
 * 所以这里的边界划得很清楚：**画布是纯视觉层**（`aria-hidden`），所有键盘
 * 可达性由页面里的节点清单承担 —— 那是一份真正的按钮列表，Tab 顺序、焦点
 * 环、Enter 语义全部来自浏览器原生行为，而且屏幕阅读器念得出「布尔代数基本
 * 运算，已熟悉，66%」。这跟图表配数据表是同一个模式（WCAG 1.1.1 认可的
 * 等价文本替代），比在画布上做位置伪装可靠得多。
 *
 * 画布自己仍然支持鼠标：点击节点进关卡、拖动平移、滚轮缩放。另外提供三个
 * **键盘可用的缩放按钮** —— 滚轮对键盘用户不可用，而缩放恰恰是票 03 第 6 条
 * 的验证入口。
 *
 * ## 为什么力导向必须进 Worker
 *
 * 见 `layout.ts`。一句话：同步迭代会冻结主线程，而票 03 第 1 条要求 2000+
 * 节点下拖动缩放仍可交互。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sigma from 'sigma';
import { sdfCircle, sdfDiamond, sdfSquare, sdfTriangle } from 'sigma/rendering';
import type { GraphEdge, GraphNode } from '../api/generated/model';
import { CinematicCamera } from './camera.js';
import { shouldShowLabels, shouldShowNodeLabel } from './label-threshold.js';
import { buildLayoutGraph, nodeDiameter, startLayout, type LayoutHandle } from './layout.js';
import { useGraphColors } from './palette.js';
import {
  nodeAccessibleLabel,
  STATUS_SHAPE,
  toDisplayStatus,
  type DisplayStatus,
} from './status.js';

/**
 * 我们真正用到的那一小面 sigma。
 *
 * 不直接用 `Sigma<...>` 的完整泛型是因为它会随构造参数（图属性 / primitives）
 * 逐层推导，把实例存进 `useRef` 就得跟着写一串类型体操。收窄成显式接口还有
 * 个实在的好处：它等于给「我们依赖 sigma 的哪些能力」列了份清单，将来升大
 * 版本时改动点一目了然。
 */
interface CameraSurface {
  getState(): { ratio: number; x: number; y: number };
  setState(state: Partial<{ x: number; y: number; ratio: number }>): unknown;
  on(event: 'updated', listener: (state: { ratio: number }) => void): unknown;
  animate(
    state: Partial<{ x: number; y: number; ratio: number }>,
    options?: { duration?: number },
  ): Promise<void>;
  zoomIn(options?: { factor?: number }): Promise<void>;
  zoomOut(options?: { factor?: number }): Promise<void>;
  reset(): Promise<void>;
  removeAllListeners(): unknown;
}

interface SigmaSurface {
  getCamera(): CameraSurface;
  getNodeDisplayedLabels(): Set<string>;
  graphToViewport(point: { x: number; y: number }): { x: number; y: number };
  refresh(options?: { skipIndexation?: boolean }): unknown;
  on(event: 'afterRender', listener: () => void): unknown;
  on(event: 'clickNode', listener: (payload: { node: string }) => void): unknown;
  on(event: 'enterNode', listener: (payload: { node: string }) => void): unknown;
  on(event: 'leaveNode', listener: () => void): unknown;
  removeAllListeners(): unknown;
  kill(): unknown;
}

export interface GraphCanvasProps {
  /** 已经裁好的可见子集 */
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  /** 焦点微知识点 id：始终带标签，且相机初始落在这里 */
  focusId: string | null;
  /** 点击一个节点：进入该微知识点的详情页 */
  onOpenNode: (microKpId: string) => void;
  /** 相机 ratio 变化时上报，供页面显示当前缩放 */
  onRatioChange?: (ratio: number) => void;
  /**
   * 交出程序化相机的挂点（票 62 验收第 5 条）。
   *
   * 挂载后 `ref.current` 是一台可 `animate`/`setState`/`getState` 的相机；
   * 卸载（或画布重建）后置回 `null`。不传时行为与以前完全一致 —— 没有
   * 全局注册表，也没有模块级单例：生命周期跟着这块画布走。
   */
  cameraRef?: React.RefObject<CinematicCamera | null>;
}

/**
 * 节点尺寸的**相对**权重（状态第二编码之外的注意力引导）。
 *
 * 差异刻意但克制：需复验略大（需要被看见），未学与已掌握略小。差别不足以
 * 替代形状编码，只是让注意力有个轻微方向。
 *
 * 注意这里是**权重**不是像素 —— 真正的像素直径由 `nodeDiameter(节点数)` 决定
 * （定义在 `layout.ts`：它的依据是布局跑完之后节点之间的实际间距）。
 * `review` 的权重是分母，即「最大状态拿满直径」。
 */
const NODE_SIZE_RATIO: Record<DisplayStatus, number> = {
  unseen: 7,
  learning: 8,
  mastered: 7,
  review: 9,
};

/**
 * 把状态权重归一化到目标直径：`review` 拿满直径，其余按比例小一点。
 *
 * 以最大权重为分母（而不是以 unseen 为分母）是有意的：这样
 * `nodeDiameter()` 算出的值就是画布上**最大**的那个节点，可分辨度指标
 * （用直径当阈值）才是保守估计 —— 小节点只会更容易分开。
 */
function nodeSize(count: number, status: DisplayStatus): number {
  return (nodeDiameter(count) * NODE_SIZE_RATIO[status]) / NODE_SIZE_RATIO.review;
}

/**
 * 画布上的颜色**全部**来自 `useGraphColors()`（票 62）：连线、标签、焦点底衬
 * 与四类节点色各自是一个 `graph-*` token。这里曾经把连线色与焦点底衬色写成
 * 两个字面量常量 —— 它们的问题不是「写死了一个值」，
 * 而是那个值在亮色主题下没有对应的版本，于是切主题时只有节点色变、连线还是
 * 旧暗色。颜色进 palette 之后，「两套主题」变成数据上的两行，而不是代码里的
 * 两个分支。
 */

/**
 * 画布状态上报的最小间隔（毫秒）。
 *
 * `afterRender` 在布局收敛过程中每帧触发；每次都 `setState` 会让 React 每帧
 * 重渲，而 ratio 与标签数只变了微不足道的一点。100ms ≈ 10Hz 足够跟手。
 */
const REPORT_THROTTLE_MS = 100;

/**
 * 布局收敛的时间预算（毫秒）：超过之后停掉 worker。
 *
 * ## 为什么必须有这个预算
 *
 * FA2 的 supervisor 是一个**自循环**：每轮算完把坐标写回 graphology，问一句
 * 「还要不要继续」，永远只会答「要」。它不会自己判断「够好了」。
 *
 * 而写回坐标走的是 `graph.updateEachNodeAttributes()`，它**不带 hints** 地
 * emit `eachNodeAttributesUpdated` —— sigma 那边的监听器读到 `hints === null`
 * 就认为「可能动了位置」，于是对**每一个节点**重跑索引（`refresh({partialGraph:
 * {nodes: 全部}})`）。2000 节点上这一趟是 70–200ms，而 worker 每秒回几十轮。
 *
 * 实测（生产构建、2000 节点）：不设预算时收敛期**持续**出现 70–200ms 的长
 * 任务，画布看起来在动但滚轮要 700ms 才响应 —— 正是票 03 第 1 条要禁止的
 * 「布局阻塞交互」。设 4s 预算后收敛期长任务降到 0，因为 worker 停了就不再
 * 触发重索引。
 *
 * 4 秒的依据：FA2 在千级节点上大约需要 2–4 秒把主要结构拉开（之后再迭代只
 * 是像素级微调），而人对「打开页面后值得等多久」的容忍上限差不多就是几秒。
 */
const LAYOUT_BUDGET_MS = 4_000;

export function GraphCanvas({
  nodes,
  edges,
  focusId,
  onOpenNode,
  onRatioChange,
  cameraRef,
}: GraphCanvasProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<SigmaSurface | null>(null);
  const layoutRef = useRef<LayoutHandle | null>(null);
  /**
   * 画布颜色（票 62）。随 `<html data-sm-theme>` 变，不需要 ThemeProvider。
   *
   * sigma 的 reducer 是构造时抓走的闭包，拿不到后来的值 —— 所以除了下面的
   * `displayRef`，再留一个 `colorsRef` 给连线与焦点底衬这两个也在闭包里的
   * 角色用。reducer 里读 ref，主题变化时再整图 `refresh()` 一次。
   */
  const colors = useGraphColors();
  const colorsRef = useRef(colors);
  colorsRef.current = colors;

  const [ratio, setRatio] = useState(1);
  const [displayedLabels, setDisplayedLabels] = useState(0);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * 容器暂时量不出宽度（票 47）。
   *
   * 与 `error` 分开：`error` 是「这个环境永远画不出图」（没有 WebGL2），
   * 一旦置位就不再重试；而宽度是**会变回来**的 —— 窗口拉宽、或栅格在
   * ≤1080px 切成单列之后，同一块画布就该正常建起来。所以它是独立的状态，
   * 由 `ResizeObserver` 负责翻回去。
   */
  const [needsWidth, setNeedsWidth] = useState(false);
  /**
   * 布局跑在哪：`worker` 还是退化后的 `static`。
   *
   * 露在 DOM 上不是为了调试，而是票 03 第 1 条「物理模拟不得阻塞主线程」
   * 需要一个可断言的事实。e2e 里既读这个属性（意图），也测长任务时长
   * （结果）—— 只有前者等于「我以为用了 Worker」，只有后者则难以区分是
   * 布局还是渲染卡住。
   */
  const [layoutSource, setLayoutSource] = useState<'worker' | 'static'>('static');

  /**
   * 每个节点的显示属性。
   *
   * 用 `useMemo` 缓存是必要的：sigma 的 `nodeReducer` 每次数据刷新都会对每个
   * 节点调用一次，在 reducer 里现算 `toDisplayStatus` 意味着每次刷新上千次
   * `new Date()`。
   */
  const display = useMemo(() => {
    const now = new Date();
    const count = nodes.length;
    const map = new Map<
      string,
      {
        status: DisplayStatus;
        color: string;
        labelColor: string;
        shape: string;
        size: number;
      }
    >();
    for (const node of nodes) {
      const status = toDisplayStatus(node, now);
      map.set(node.microKpId, {
        status,
        color: colors.nodes[status],
        // sigma 的默认标签色是纯黑。深色画布上那是「有标签但看不见」——
        // 实测比没有标签更糟：它会挤掉邻近节点本可以显示的名字。
        labelColor: colors.label,
        shape: STATUS_SHAPE[status],
        size: nodeSize(count, status),
      });
    }
    return map;
  }, [nodes, colors]);

  // reducer 是 sigma 在构造时抓走的闭包，读 ref 才能拿到最新值而不重建 sigma
  const focusRef = useRef<string | null>(focusId);
  focusRef.current = focusId;
  const highlightRef = useRef<string | null>(null);
  highlightRef.current = highlighted;
  const ratioRef = useRef(1);
  // 不写成 `ratioRef.current = ratio`：ratio 是节流后上报的**���值**，而 ref 要的是
  // 相机此刻的真实值（reducer 在 refresh 时同步读它）。两者的写入点都在下面
  // 的 report()/handleCamera 里，这里不再用渲染期赋值把它们混在一起。
  const displayRef = useRef(display);
  displayRef.current = display;

  /**
   * 创建 / 销毁 sigma。
   *
   * 依赖只有 `nodes`/`edges` 的**身份**：可见子集一变就整体重建，因为 sigma
   * 没有「增量替换节点集」的公开 API。重建代价是重跑圆环种子 + 重启动 worker
   * （167 个节点上是毫秒级），换来「两边节点集合永远一致」这个不用维护的性质。
   * 焦点/高亮/ratio 全走 ref，所以它们变化不会误触发重建。
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    /**
     * 宽度为 0 时**不构造 sigma**，等它长出宽度再来（票 47）。
     *
     * `new Sigma()` 的构造器里就会 `resize()`，而 sigma 的 `resize()` 在
     * `offsetWidth === 0` 时抛 `Sigma: Container has no width`。更麻烦的是
     * 它还把 `handleResize` 挂在 `window` 上：`scheduleRefresh()` → 下一帧
     * `render()` → `this.resize()`，所以**每一次窗口 resize 都会再抛一次**，
     * 而且整条链在 React 的错误边界之外 —— `try/catch` 只接得住第一次，
     * 后面每次 resize 都是一条真实的未捕获错误（e2e 里就是 pageerror）。
     *
     * 两个备选：
     * - `allowInvalidContainer: true`：sigma 会把宽度当成 1px 继续跑。错误
     *   是没了，但画布真的只有 1px 宽 —— 用户看到的仍然是「什么都没有」，
     *   只是我们不再知道这件事。**把异常藏起来不等于修好**。
     * - 先量宽度、量不到就不建：画布真的窄的时候，我们如实告诉用户
     *   「这里放不下」，并把节点清单（它的等价文本）留在页面上。宽度一旦
     *   出现（窗口拉宽、或栅格在 ≤1080px 切成单列），`ResizeObserver` 立刻
     *   把画布建起来。
     *
     * 这里选后者。`needsWidth` 是唯一的额外状态：它只在这条降级路径上
     * 翻一次面，正常宽度下 effect 一次就跑完，不会多一次重建。
     */
    if (container.offsetWidth === 0) {
      setNeedsWidth(true);
      const observer = new ResizeObserver(() => {
        if (container.offsetWidth > 0) {
          observer.disconnect();
          setNeedsWidth(false);
        }
      });
      observer.observe(container);
      return () => {
        observer.disconnect();
      };
    }

    let cancelled = false;
    const graph = buildLayoutGraph(nodes, edges);
    const layout = startLayout(graph);
    layoutRef.current = layout;

    let created: SigmaSurface;
    try {
      created = new Sigma(graph, container, {
        // 多形状必须显式声明 —— 不传 primitives 就只有圆形，
        // 第二编码会静默退化成「全是圆」
        primitives: {
          nodes: { shapes: [sdfCircle(), sdfSquare(), sdfDiamond(), sdfTriangle()] },
        },
        settings: {
          renderEdgeLabels: false,
          // 标签显隐完全由 label-threshold.ts 按相机 ratio 决定。把 sigma 自带
          // 的尺寸阈值关掉，避免两套规则同时生效、互相打架。
          labelRenderedSizeThreshold: 0,
          // 标签去重的网格边长（sigma 默认 60px）。默认值只管「两个标签中心别落在
          // 同一格」，但中文知识点名动辄 10 个字、宽 140px 上下，60px 的格子挡不住
          // 互相压盖：默认视野下实测画出 22 个标签，中央密区糊成一片，一个也读不出。
          // 160px 让画出来的标签彼此至少隔开一个标签宽度，860×480 的画布上大约
          // 留下十几个，够看且不重叠。
          labelGridCellSize: 160,
          hideLabelsOnMove: true,
          enableCameraPanning: true,
          enableCameraZooming: true,
          // 不启用节点拖动：图谱是导航不是编辑器。拖完 worker 会把位置拉回去，
          // 用户会觉得「拖了个寂寞」。
          enableNodeDrag: false,
          // 缩小到看全图时画布不会细到看不见线
          minCameraRatio: 0.02,
          maxCameraRatio: 20,
          stagePadding: 40,
          // `size` 是**屏幕像素**，不随相机缩放。
          //
          // sigma 4 把 `itemSizesReference` 的默认值改成了 `'positions'`（v3 是
          // `'screen'`）：此时 `scaleSize()` 会乘上 `cameraRatio * graphToViewportRatio`，
          // 也就是「size 的单位是图坐标，不是像素」。两个单位一乘，一个节点就被
          // 放大到几千像素 —— 整块画布被最后画的那个节点的颜色填满。实测现象是
          // 地图页画布被单个节点的颜色填满（`unseen` 那种灰蓝）、3 秒与 23 秒
          // 的截图字节完全相同（6446 bytes），而右侧清单有 5495 项。
          // 显式写 `'screen'` 把语义钉回「像素」，不依赖库的默认值。
          itemSizesReference: 'screen',
          // 节点直径按节点数缩到 2–9px（见 `nodeDiameter()`）。5495 节点时只有
          // 3.26px，靠指针去点它是不现实的 —— 把**拾取用的 quad** 向外撑 8px。
          //
          // 这不会改变视觉尺寸：sigma 的 picking pass 是独立的 framebuffer，
          // `u_pickingPadding` 只在 `#ifdef PICKING_MODE` 里生效（顶点着色器把
          // quad 外扩、片元着色器放宽 SDF 阈值）。等价于「可见的点小、能点的
          // 范围大」，比叠一层透明热区 DOM 便宜，也不会破坏 `aria-hidden` 的
          // 画布边界（票 03 第 2 条禁止在画布上叠可交互的透明层）。
          nodePickingPadding: 8,
        },
        nodeReducer: (key) => {
          const info = displayRef.current.get(key);
          if (!info) return {};
          const isFocus = focusRef.current === key;
          const isHighlighted = highlightRef.current === key;
          return {
            color: info.color,
            labelColor: info.labelColor,
            // 第二编码：形状随状态变，缩到很小、色盲、灰度打印下都还在
            shape: info.shape,
            size: isHighlighted ? info.size * 1.7 : isFocus ? info.size * 1.4 : info.size,
            labelVisibility: shouldShowNodeLabel(ratioRef.current, isFocus) ? 'auto' : 'hidden',
            zIndex: isFocus ? 3 : isHighlighted ? 2 : 1,
            // 焦点带一圈底衬，缩到全图也认得出它在哪（票 03 第 4 条的视觉面）
            backdropVisibility: isFocus ? 'visible' : 'hidden',
            backdropColor: colorsRef.current.backdrop,
            backdropPadding: 4,
            backdropCornerRadius: 6,
          };
        },
        // 连线颜色同样来自 token：两套主题各一档，闭包读 ref 拿最新值
        edgeReducer: () => ({ color: colorsRef.current.edge, size: 1 }),
      }) as unknown as SigmaSurface;
    } catch (cause) {
      // WebGL 不可用（禁用硬件加速、远程桌面、无 GPU 的容器）。这是真实的
      // 降级场景，不是 bug：说清「画布不可用但清单还在」比白屏好。
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      layout.stop();
      return;
    }

    sigmaRef.current = created;
    setLayoutSource(layout.usesWorker ? 'worker' : 'static');
    const camera = created.getCamera();

    /**
     * 把真实相机接到「程序化相机」上（票 62 验收第 5 条）。
     *
     * 适配器只转发三个东西：读状态、立即跳转、平滑移动。sigma 的
     * `Camera.setState()` 接受 Partial，这里补上完整状态由 `CinematicCamera`
     * 负责合并 —— 适配器保持「原样转发」，语义集中在相机类里，才能在
     * jsdom 里测。
     */
    if (cameraRef) {
      cameraRef.current = new CinematicCamera({
        getState: () => {
          const state = camera.getState();
          return { x: state.x, y: state.y, ratio: state.ratio };
        },
        setState: (next) => {
          camera.setState(next);
        },
        animate: (next, options) => camera.animate(next, options),
      });
    }

    /**
     * 到点就停 worker：停止**位置写回**，也就停止了 sigma 的整图重索引。
     *
     * 用 `stop()` 而不是 `kill()`：`stop()` 只是让 supervisor 不再请求下一轮，
     * worker 线程与矩阵都还在，将来要「重新排布」按钮可以直接 `start()`。
     * 而 `kill()` 之后 supervisor 就废了（再 start 会抛 "layout was killed"）。
     */
    const budgetTimer = window.setTimeout(() => {
      layout.stopConverging();
    }, LAYOUT_BUDGET_MS);

    let lastReport = 0;
    let reportTimer: number | null = null;
    /**
     * 上报真实状态：相机 ratio + sigma 当前实际画出的标签数。
     *
     * `getNodeDisplayedLabels()` 是 sigma 在密度抽样与阈值判定**之后**的结果，
     * 所以它才是「标签到底显示了没有」的真源；自己另外维护一个布尔值只能证明
     * 「我以为我隐藏了」。票 03 第 6 条的 e2e 就断言这个数。
     *
     * 节流必须**补尾部**：相机动画的最后一帧往往落在窗口中间，如果直接丢掉，
     * `data-camera-ratio` 就会永远停在中间值（实测：缩小再放大后卡在 1.078，
     * 而真实 ratio 已经是 1）。之前没暴露是因为每一帧都 refresh，`afterRender`
     * 会顺便把尾部补上；现在 refresh 只在跨阈值时发生，这个漏洞就漏出来了。
     */
    const reportNow = (): void => {
      if (cancelled) return;
      const nextRatio = camera.getState().ratio;
      ratioRef.current = nextRatio;
      setRatio((previous) => (Math.abs(previous - nextRatio) < 0.001 ? previous : nextRatio));
      const count = created.getNodeDisplayedLabels().size;
      setDisplayedLabels((previous) => (previous === count ? previous : count));
      onRatioChange?.(nextRatio);
    };
    const report = (): void => {
      if (cancelled) return;
      const now = performance.now();
      const elapsed = now - lastReport;
      if (elapsed >= REPORT_THROTTLE_MS) {
        if (reportTimer !== null) {
          window.clearTimeout(reportTimer);
          reportTimer = null;
        }
        lastReport = now;
        reportNow();
        return;
      }
      if (reportTimer !== null) return;
      reportTimer = window.setTimeout(() => {
        reportTimer = null;
        lastReport = performance.now();
        reportNow();
      }, REPORT_THROTTLE_MS - elapsed);
    };

    /**
     * 只在**跨过标签阈值**时刷新显示数据。
     *
     * `refresh()` 会让 sigma 重新跑每个节点的 reducer 并重算显示集合（数千
     * 个节点实测 40–80ms，2000 节点更久）。而相机动画每帧都发 `updated`：
     * 滚一格滚轮就是几十帧，逐帧刷新等于把主线程占满 —— e2e 里表现为
     * `mouse.wheel` / `expect.poll` 超时，用户侧表现为「滚轮拖手」，正是
     * 票 03 第 1 条要禁止的那种卡。
     *
     * 关键观察：`labelVisibility` 只取决于「ratio 是否越过 LABEL_HIDE_RATIO」
     * 这一个布尔量（见 label-threshold.ts）。同一侧内的 ratio 变化不改变任何
     * 节点的显示数据，重算纯属浪费。所以这里记住上次的判定，翻面才刷新一次
     * —— 一次手势最多两次刷新。
     */
    let labelsShown = shouldShowLabels(camera.getState().ratio);
    const handleCamera = (): void => {
      const nextRatio = camera.getState().ratio;
      // 先写 ref 再 refresh：reducer 在 refresh 过程中同步读它，写晚了就会
      // 用旧 ratio 算出旧判定，「刷新了但标签没换」。
      ratioRef.current = nextRatio;
      const nextShows = shouldShowLabels(nextRatio);
      if (nextShows !== labelsShown) {
        labelsShown = nextShows;
        created.refresh({ skipIndexation: true });
      }
      report();
    };
    camera.on('updated', handleCamera);
    created.on('afterRender', report);
    report();

    created.on('clickNode', ({ node }) => {
      onOpenNode(node);
    });
    created.on('enterNode', ({ node }) => {
      setHighlighted(node);
    });
    created.on('leaveNode', () => {
      setHighlighted(null);
    });

    /**
     * 容器变宽/变窄后重新取景（2560 下图谱挤在中间一团的修复）。
     *
     * 背景：sigma 在窗口 resize 时自己会 `resize()`，但**相机 ratio 不变** ——
     * 视口变大只意味着「看到的世界更多」，于是原本取好景的图缩在正中一小块。
     * 实测 2560 宽下 3085 个点只占画布中间约 40%。
     *
     * 只在 `ratio <= 1.05`（仍处于「全图适配」状态）时才重置：学生自己放大
     * 到某一块后拉窗口，不该被拽回全图。这个判据比「有没有交互过」更简单，
     * 也覆盖了「缩放后又缩小回全图」的情形。
     */
    let lastWidth = container.offsetWidth;
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            const width = container.offsetWidth;
            if (Math.abs(width - lastWidth) < 24) return;
            lastWidth = width;
            if (ratioRef.current > 1.05) return;
            /* sigma 的 ratio=1 并不是「铺满画布」，而是 1 世界单位 = 1 像素：
               图有多大就画多大。所以视口变宽后必须**算一个真正的适配比例**，
               `camera.reset()` 只会回到 ratio 1（实测 2560 下 3085 个点仍只占
               画布中间约三分之一）。这里按节点包围盒与画布尺寸取较小者。 */
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            graph.forEachNode((_id, attrs) => {
              const x = typeof attrs.x === 'number' ? attrs.x : 0;
              const y = typeof attrs.y === 'number' ? attrs.y : 0;
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            });
            const bw = maxX - minX;
            const bh = maxY - minY;
            const ch = container.offsetHeight;
            if (!(bw > 0) || !(bh > 0) || ch <= 0) return;
            const fit = Math.min(width / bw, ch / bh) * 0.92;
            created.getCamera().setState({
              x: (minX + maxX) / 2,
              y: (minY + maxY) / 2,
              ratio: Number.isFinite(fit) && fit > 0 ? fit : 1,
            });
          });
    resizeObserver?.observe(container);

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      window.clearTimeout(budgetTimer);
      // 尾部补发计时器必须清：它会在组件卸载后调 setState（React 会警告，
      // 而建-拆画布在切视图时是常态，不是异常路径）。
      if (reportTimer !== null) window.clearTimeout(reportTimer);
      camera.removeAllListeners();
      created.removeAllListeners();
      created.kill();
      sigmaRef.current = null;
      // 相机随画布一起消失：调用方手里的 ref 必须变回 null，否则它会在
      // 一块已经不存在的画布上 animate（sigma 的 Camera 不会报错，只是
      // 悄悄改不到任何东西——比抛错更难查）。
      if (cameraRef) cameraRef.current = null;
      layout.stop();
      layoutRef.current = null;
    };
    // `needsWidth` 必须在依赖里：宽度从 0 变成非 0 时，是它把 effect 叫醒、
    // 真正把 sigma 建起来的那一下。少了它，ResizeObserver 翻完状态就没人接手。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, needsWidth]);

  /**
   * 主题变化时整图刷一次（票 62 验收第 2 条）。
   *
   * 为什么必须整图 `refresh()`（不带 `skipIndexation`）：节点色与标签色在
   * `nodeReducer` 里，靠 `refresh()` 重跑就能换；但**连线颜色在
   * `edgeReducer` 里**，只有完整刷新才会重新算一遍边的显示数据。这里刻意
   * 不动建 sigma 的 effect 依赖 —— 重建画布会把相机、worker、布局全推倒
   * 重来，而换主题不该让地图「重新加载」。
   *
   * 首次渲染跳过一次：建画布那一下内部已经刷新过，再刷一次是白花 40–80ms
   * （数千节点的实测值）。
   */
  const themeRefreshSkipped = useRef(false);
  useEffect(() => {
    if (!themeRefreshSkipped.current) {
      themeRefreshSkipped.current = true;
      return;
    }
    sigmaRef.current?.refresh();
  }, [colors]);

  /**
   * 焦点变化时把相机移到该节点。
   *
   * 这是「从关卡返回、焦点保持原位」的视觉面：URL 带着 `?focus=` 重建地图页
   * 后，相机应当落在那颗点上，而不是回到画布中心。
   */
  useEffect(() => {
    const sigma = sigmaRef.current;
    const layout = layoutRef.current;
    if (focusId === null || !sigma || !layout) return;
    if (!layout.graph.hasNode(focusId)) return;
    const attributes = layout.graph.getNodeAttributes(focusId);
    const camera = sigma.getCamera() as unknown as {
      animate(state: { x: number; y: number }, options?: { duration?: number }): Promise<void>;
    };
    void camera.animate({ x: attributes.x, y: attributes.y }, { duration: 350 });
    /**
     * 焦点换了必须刷一次：`shouldShowNodeLabel` 给焦点开了「永远显示标签」的例外，
     * 尺寸也乘了 1.4。以前这些是靠相机逐帧 refresh 顺带兑现的，现在 refresh 只在
     * 跨阈值时发生，所以得在这里显式补一下（一次，不是每帧）。
     */
    sigma.refresh({ skipIndexation: true });
    // 只依赖焦点自身：节点集变化由上面的 effect 重建画布时自然带着坐标走
  }, [focusId]);

  const zoom = useCallback((direction: 'in' | 'out' | 'reset') => {
    const camera = sigmaRef.current?.getCamera();
    if (!camera) return;
    if (direction === 'in') void camera.zoomIn();
    else if (direction === 'out') void camera.zoomOut();
    else void camera.reset();
  }, []);

  if (error !== null) {
    return (
      <div className="graph-canvas graph-canvas-broken" data-graph-error={error}>
        <p>
          这个浏览器/显卡环境没有可用的 WebGL2，图谱画布无法渲染。右侧的节点清单仍然可以逐个打开。
        </p>
      </div>
    );
  }

  return (
    <div
      className="graph-canvas"
      // 供 e2e 读真实状态。data-labels-visible 是我们的策略结论，
      // data-labels-displayed 是 sigma 实际画出的标签数 —— 两个都露出来，
      // 免得将来只改了其中一个还以为行为对了。
      data-camera-ratio={ratio.toFixed(3)}
      data-node-count={nodes.length}
      data-labels-visible={shouldShowLabels(ratio) ? 'true' : 'false'}
      data-labels-displayed={displayedLabels}
      data-layout-source={layoutSource}
    >
      <div className="graph-canvas-webgl" ref={containerRef} aria-hidden="true" />
      {needsWidth ? (
        /*
         * 宽度不足时如实说明（票 47）。
         *
         * 不渲染缩放按钮：这时根本没有相机，三个按钮点下去全是空操作 ——
         * 留着只会让人以为「按了没反应」。而「画布不可用、清单还在」这句话
         * 本身是有用的信息，比一块空画布强。
         */
        <p className="graph-canvas-blocked" data-graph-blocked="width">
          这块屏幕放不下图谱画布（宽度不足）。节点清单仍然可以逐个打开；把窗口拉宽一些，画布会自动出现。
        </p>
      ) : (
        <>
          <div className="graph-canvas-zoom">
            <button type="button" aria-label="放大图谱" onClick={() => zoom('in')}>
              ＋
            </button>
            <button type="button" aria-label="缩小图谱" onClick={() => zoom('out')}>
              －
            </button>
            <button type="button" aria-label="复位图谱视野" onClick={() => zoom('reset')}>
              ⌂
            </button>
          </div>
          <p className="graph-canvas-hint">
            拖动平移、滚轮缩放、点击节点进入关卡。
            <span className="graph-canvas-hint-a11y">
              （画布的等价文本在右侧节点清单里，可用 Tab 逐个浏览、Enter 打开。）
            </span>
          </p>
        </>
      )}
    </div>
  );
}
