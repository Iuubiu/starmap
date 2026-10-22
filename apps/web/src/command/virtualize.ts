/**
 * 定高行的窗口化计算 —— 纯函数。
 *
 * ## 为什么自己写
 *
 * 面板要在 3086 个知识点里搜。全量挂进 DOM 意味着一次输入要创建 3000 个
 * 节点，每次按键重新 diff 一遍 —— 那正是「搜索要等一下」的来源。窗口化之后
 * DOM 里恒定是「可见行 + 上下各 6 行」，与总条数无关。
 *
 * 引 `react-window` / `@tanstack/react-virtual` 也能做，但那两个库各带一套
 * 测量/滚动/尺寸监听，而这里**行高是固定的**（面板的行按设计就是 30px 紧凑
 * 行），需要的只是「从 scrollTop 反推哪几行可见」这一道算术。多一个依赖换来
 * 的是一份用不上的能力。
 *
 * ## 为什么不测行高
 *
 * 测量会引入「首帧高度为 0」的分支，而那一帧的表现就是「列表空着」。行高
 * 由 CSS 与常量共同钉死（`ROW_HEIGHT`），CSS 里 `.sm-palette__row` 的
 * `height` 与它同值 —— 两处写同一个数字是本模块唯一需要人工保持一致的约定，
 * 所以它在两边都写了注释互相指认。
 */

export interface VirtualWindow {
  /** 第一条要渲染的行下标（含） */
  start: number;
  /** 最后一条要渲染的行下标（不含） */
  end: number;
  /** 第一条要渲染的行相对滚动内容顶部的像素偏移 */
  offset: number;
  /** 滚动内容的总高度（= 总行数 × 行高），用于撑出滚动条 */
  totalHeight: number;
}

export interface VirtualInput {
  total: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  /** 上下各多渲染几行，抵消快速滚动时的空白 */
  overscan?: number | undefined;
}

/**
 * 算出当前可见窗口。
 *
 * 所有入参都可能来自浏览器（`scrollTop` 会是小数、`clientHeight` 可能是 0），
 * 所以每一步都夹紧而不是假设。越界时返回「空窗口」而不是抛错 —— 列表为空是
 * 正常状态（搜不到东西），不是缺陷。
 */
export function computeWindow(input: VirtualInput): VirtualWindow {
  const { total, rowHeight, viewportHeight, scrollTop } = input;
  const overscan = Math.max(0, input.overscan ?? 0);

  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(rowHeight) || rowHeight <= 0) {
    return { start: 0, end: 0, offset: 0, totalHeight: 0 };
  }

  const safeScrollTop = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const safeViewport = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;

  const firstVisible = Math.floor(safeScrollTop / rowHeight);
  const start = Math.min(total, Math.max(0, firstVisible - overscan));

  /* `+1`：视口通常不是行高的整数倍，底部那一行是半截的，仍然要渲染。 */
  const visibleCount = Math.ceil(safeViewport / rowHeight) + 1 + overscan * 2;
  const end = Math.min(total, start + Math.max(1, visibleCount));

  return { start, end, offset: start * rowHeight, totalHeight: total * rowHeight };
}
