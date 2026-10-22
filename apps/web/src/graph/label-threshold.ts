/**
 * 标签随缩放显隐（票 03 第 6 条）。
 *
 * ## 为什么不用 sigma 自带的阈值
 *
 * sigma 的 `labelRenderedSizeThreshold` 比较的是**节点渲染后的屏幕尺寸**
 * （`internals.scaleSize(size)`），不是相机缩放比。那个值同时受节点 `size`
 * 属性、`itemSizesReference`、`stagePadding` 影响 —— 换句话说，同一台相机
 * 下「标签是不是显示」取决于数据里每个点画多大，是个飘忽的量。用它做验收
 * 断言会得到一个只在当前数据上成立的结论。
 *
 * 相机 `ratio` 则是**纯粹的用户意图**：`1` 是默认视野，越大越缩小。所以
 * 这里用 ratio 做判据，`nodeReducer` 据此返回 `labelVisibility: 'hidden'`
 * 强制隐藏（sigma 里 `labelVisibility === 'hidden'` 会在密度抽样之前就跳过
 * 该节点，见 `computeDisplayedNodeLabels`）。
 *
 * ## 阈值的取值
 *
 * `1.6`。默认 ratio 是 `1`，鼠标滚一格是 `1.7` 倍 —— 也就是说用户**缩小一格**
 * 就会失去标签。这个激进度是对的：标签在地图页是「顺带读一下」的信息，缩到
 * 看全图时留着的标签会糊成一片；而节点本身（点/方块/菱形/三角）始终在，
 * 需要细看时放大一格就回来。同时 `hideLabelsOnMove` 也开着，拖动过程中不画。
 */

/** 相机 ratio（sigma 的 `CameraState.ratio`）超过这个值就只画点、不画标签。 */
export const LABEL_HIDE_RATIO = 1.6;

/**
 * 当前缩放下是否该显示标签。
 *
 * `ratio` 非法（NaN/Infinity）时返回 `true`：宁可多画标签，不要因为一个坏
 * 相机状态让整张图看起来是空的。
 */
export function shouldShowLabels(ratio: number): boolean {
  if (!Number.isFinite(ratio)) return true;
  return ratio < LABEL_HIDE_RATIO;
}

/**
 * 一个节点此刻是否显示标签。
 *
 * 除了缩放，还有两个例外：
 * 1. **焦点节点永远显示标签** —— 它是整张图的参照点，缩到全图时如果连它
 *    都没名字，用户会彻底失去方位感（「焦点保持原位」这条验收也就无从验证）。
 * 2. 悬停/选中由 sigma 的 `backdrop` 与描边表达，不占用标签通道。
 */
export function shouldShowNodeLabel(ratio: number, isFocus: boolean): boolean {
  return isFocus || shouldShowLabels(ratio);
}
