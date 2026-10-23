/**
 * 画布悬停名牌落在哪儿（票 86）。
 *
 * ## 为什么这不是「顺手写两个 clamp」
 *
 * 名牌是一个跟着指针走的 DOM 浮层。鼠标停在画布**边缘**的节点上时，如果
 * 恒按「指针上方 14px、水平居中」摆放，名牌会有一半跑到画布外面 —— 画布是
 * `overflow: hidden`（.graph-canvas 里的绝对定位层），于是学生看到的是半截
 * 文字。索引类界面里这种「贴边就被裁」的浮层很常见，但它是可以被算出来的：
 * 把落点夹在画布内、上方放不下就翻到下方。
 *
 * 这段几何计算单独成纯函数，是为了能在 jsdom 里逐条断言边界（jsdom 没有
 * 布局，`getBoundingClientRect()` 全 0，摆在组件里就只能靠真浏览器碰运气）。
 * 组件只负责把指针坐标与名字宽度预算喂进来、把结果写成 `left/top`。
 */

/** 名牌相对指针的间隙（px）。与 `.graph-canvas-hover-label` 的视觉间距一致。 */
export const HOVER_GAP = 14;

/** 名牌距画布边缘的最小留白（px）。再小就会贴着边框、看起来像被裁。 */
export const HOVER_EDGE = 10;

/** 名牌高度预算（px）：一行 13px 文字 + 上下 4px 内边距 + 边框 ≈ 26。 */
export const HOVER_HEIGHT = 26;

/**
 * 按名字估一个宽度预算（px）。
 *
 * 中文知识点名字 13px 一字，两侧内边距加边框约 26px；上限与 CSS 的
 * `max-width: 260px` 对齐 —— 超过之后 CSS 用省略号截断，这里不用再涨。
 * 用估算而不是 `getBoundingClientRect()`：名牌是渲染后才存在的，而落点要在
 * 同一次绘制里定下来，否则第一帧会先闪到边缘再跳回来。
 */
export function estimateHoverLabelWidth(name: string): number {
  const width = 26 + name.length * 13;
  return Math.min(260, Math.max(48, width));
}

export interface HoverPoint {
  /** 指针相对画布左上角的横坐标（px） */
  readonly x: number;
  /** 指针相对画布左上角的纵坐标（px） */
  readonly y: number;
}

export interface HoverCanvas {
  readonly width: number;
  readonly height: number;
}

export interface HoverLabelOptions {
  /** 名牌与指针的间距，默认 {@link HOVER_GAP} */
  readonly gap?: number;
  /** 名牌与画布边缘的留白，默认 {@link HOVER_EDGE} */
  readonly edge?: number;
  /** 名牌宽度预算（px），用于横向夹取；默认 0 = 只夹中心点 */
  readonly labelWidth?: number;
}

export interface HoverPlacement {
  /** 名牌中心应放的横向位置（px，相对画布） */
  readonly left: number;
  /** 名牌顶边应放的纵向位置（px，相对画布） */
  readonly top: number;
  /** true = 指针上方放不下，名牌翻到指针下方 */
  readonly below: boolean;
}

/**
 * 计算名牌落点。
 *
 * 纵向：默认收在指针上方（`y - gap - 高度`），上方越界就翻到指针下方；
 * 两种情况都再夹一次画布高度，保证整块可见。
 *
 * 横向：名牌用 `translateX(-50%)` 居中于 `left`，所以要把**半宽**也留在画布
 * 内 —— 只夹中心点时，贴右边的长名字仍会被裁掉半截。画布窄到连半宽都放不下
 * 时退化为夹中心点（此时怎么放都会裁，优先保证指针附近可见）。
 */
export function placeHoverLabel(
  point: HoverPoint,
  canvas: HoverCanvas,
  options: HoverLabelOptions = {},
): HoverPlacement {
  const gap = options.gap ?? HOVER_GAP;
  const edge = options.edge ?? HOVER_EDGE;
  const half = Math.max(0, options.labelWidth ?? 0) / 2;

  const above = point.y - gap - HOVER_HEIGHT;
  const below = above < edge;
  const top = below ? point.y + gap : above;

  const minLeft = edge + half;
  const maxLeft = canvas.width - edge - half;
  const left = minLeft <= maxLeft ? clamp(point.x, minLeft, maxLeft) : clamp(point.x, edge, Math.max(edge, canvas.width - edge));

  return {
    left,
    top: clamp(top, edge, Math.max(edge, canvas.height - HOVER_HEIGHT - edge)),
    below,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
