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
import { shouldShowLabels, shouldShowNodeLabel } from './label-threshold.js';
import { buildLayoutGraph, startLayout, type LayoutHandle } from './layout.js';
import {
  nodeAccessibleLabel,
  STATUS_COLOR,
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
  getState(): { ratio: number };
  on(event: 'updated', listener: (state: { ratio: number }) => void): unknown;
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
}

/**
 * 深色画布的节点尺寸。
 *
 * 差异刻意但克制：需复验略大（需要被看见），未学与已掌握略小。差别不足以
 * 替代形状编码，只是让注意力有个轻微方向。
 */
const NODE_SIZE: Record<DisplayStatus, number> = {
  unseen: 7,
  learning: 8,
  mastered: 7,
  review: 9,
};

const EDGE_COLOR = '#2E3A4A';

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
}: GraphCanvasProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<SigmaSurface | null>(null);
  const layoutRef = useRef<LayoutHandle | null>(null);

  const [ratio, setRatio] = useState(1);
  const [displayedLabels, setDisplayedLabels] = useState(0);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    const map = new Map<
      string,
      { status: DisplayStatus; color: string; shape: string; size: number }
    >();
    for (const node of nodes) {
      const status = toDisplayStatus(node, now);
      map.set(node.microKpId, {
        status,
        color: STATUS_COLOR[status],
        shape: STATUS_SHAPE[status],
        size: NODE_SIZE[status],
      });
    }
    return map;
  }, [nodes]);

  // reducer 是 sigma 在构造时抓走的闭包，读 ref 才能拿到最新值而不重建 sigma
  const focusRef = useRef<string | null>(focusId);
  focusRef.current = focusId;
  const highlightRef = useRef<string | null>(null);
  highlightRef.current = highlighted;
  const ratioRef = useRef(1);
  ratioRef.current = ratio;
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
        },
        nodeReducer: (key) => {
          const info = displayRef.current.get(key);
          if (!info) return {};
          const isFocus = focusRef.current === key;
          const isHighlighted = highlightRef.current === key;
          return {
            color: info.color,
            // 第二编码：形状随状态变，缩到很小、色盲、灰度打印下都还在
            shape: info.shape,
            size: isHighlighted ? info.size * 1.7 : isFocus ? info.size * 1.4 : info.size,
            labelVisibility: shouldShowNodeLabel(ratioRef.current, isFocus) ? 'auto' : 'hidden',
            zIndex: isFocus ? 3 : isHighlighted ? 2 : 1,
            // 焦点带一圈底衬，缩到全图也认得出它在哪（票 03 第 4 条的视觉面）
            backdropVisibility: isFocus ? 'visible' : 'hidden',
            backdropColor: '#12161C',
            backdropPadding: 4,
            backdropCornerRadius: 6,
          };
        },
        edgeReducer: () => ({ color: EDGE_COLOR, size: 1 }),
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
    /**
     * 上报真实状态：相机 ratio + sigma 当前实际画出的标签数。
     *
     * `getNodeDisplayedLabels()` 是 sigma 在密度抽样与阈值判定**之后**的结果，
     * 所以它才是「标签到底显示了没有」的真源；自己另外维护一个布尔值只能证明
     * 「我以为我隐藏了」。票 03 第 6 条的 e2e 就断言这个数。
     */
    const report = (): void => {
      if (cancelled) return;
      const now = performance.now();
      if (now - lastReport < REPORT_THROTTLE_MS) return;
      lastReport = now;
      const nextRatio = camera.getState().ratio;
      setRatio((previous) => (Math.abs(previous - nextRatio) < 0.001 ? previous : nextRatio));
      const count = created.getNodeDisplayedLabels().size;
      setDisplayedLabels((previous) => (previous === count ? previous : count));
      onRatioChange?.(nextRatio);
    };

    const handleCamera = (): void => {
      // reducers 改了 labelVisibility，必须让 sigma 重算显示数据
      created.refresh({ skipIndexation: true });
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

    return () => {
      cancelled = true;
      window.clearTimeout(budgetTimer);
      camera.removeAllListeners();
      created.removeAllListeners();
      created.kill();
      sigmaRef.current = null;
      layout.stop();
      layoutRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

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
    </div>
  );
}
