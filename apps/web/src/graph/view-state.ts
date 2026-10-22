/**
 * 画布的视图状态：焦点、跳数、视图模式 —— 以及它们在 URL 里的表示。
 *
 * ## 为什么状态住在 URL 里
 *
 * 票 03 第 4 条要求「从关卡返回时焦点保持原位」。关卡页（`/map/:microKpId`
 * → 关卡 → 返回）会把组件卸载再重建，任何存在 `useState` 里的焦点都会丢。
 * 而「返回地图」这个动作本身是一个导航，URL 是唯一能跨导航存活的地方。
 *
 * 顺带解决了另外两件事：刷新页面保持原位（否则用户每次 F5 都要重新找自己
 * 看到哪了）、以及链接可分享（把 `?focus=kp-bool` 发给同学，他打开就在同一
 * 位置）。
 *
 * ## 为什么是 view 而不是 mode
 *
 * `view=graph|mainline`。用 `view` 是因为它在 spec 里就是「视图」，而
 * `mode` / `tab` 都容易跟别的概念撞（比如关卡里的模式）。
 */
import { clampHops, DEFAULT_HOPS } from './topology.js';

/** 两种视图：力导向图谱（默认）/ 线性主线。 */
export type ViewMode = 'graph' | 'mainline';

export interface ViewState {
  /** 焦点微知识点 id；null = 没有焦点（看全图） */
  focus: string | null;
  /** 邻域跳数；null = 全图 */
  hops: number | null;
  mode: ViewMode;
}

/**
 * 三档视野就是票 03 第 2 条要的那三档：全图 / 焦点邻域 / 跳数可调。
 *
 * 曾经想再加一档「整章」（同模块全展开），给真实数据里 109/167 个没有先修边
 * 的孤立节点一条出路。但因为同模块成团会让 1 跳 = 一整章，跳数就失去拓扑
 * 含义；而把它做成第四档又等于给「视野」加一个只在特定数据形态下有用的
 * 模式。最后的选择是：**不加档**，孤立节点照实显示「邻域只有它自己」，
 * 并在提示里给出两条现成的出路（回全图 / 切线性主线）。诚实比多一个模式好。
 */
export const DEFAULT_VIEW: ViewState = { focus: null, hops: null, mode: 'graph' };

/** 全图模式在 URL 里的哨兵值：`hops=all`。比 `hops=-1` 可读，也不会跟数字范围打架。 */
export const HOPS_ALL = 'all';

/**
 * 从 URL 的 query 里解析视图状态。
 *
 * **宽容**是刻意的：这个字符串可能来自用户手改、旧版本的链接、或另一个
 * 泳道拼错的地址。解析失败一律回落到默认值，绝不抛错 —— 地图页白屏的
 * 代价远大于「跳数不是你填的那个 2」。
 */
export function parseViewState(params: URLSearchParams): ViewState {
  const focusRaw = params.get('focus');
  // 空字符串当成没焦点：`?focus=` 是「清空焦点」的自然写法
  const focus = focusRaw !== null && focusRaw.length > 0 ? focusRaw : null;

  const hopsRaw = params.get('hops');
  let hops: number | null;
  if (hopsRaw === null) {
    // 没写 hops：有焦点就按默认两跳（票 03 的默认视野），没焦点就是全图
    hops = focus === null ? null : DEFAULT_HOPS;
  } else if (hopsRaw === HOPS_ALL) {
    hops = null;
  } else {
    const parsed = Number(hopsRaw);
    hops = Number.isFinite(parsed) ? clampHops(parsed) : DEFAULT_HOPS;
  }

  const mode = params.get('view') === 'mainline' ? 'mainline' : 'graph';
  return { focus, hops, mode };
}

/**
 * 视图状态 → URLSearchParams。
 *
 * 默认值不写进 URL：`/map` 比 `/map?view=graph&hops=all` 干净，也让「有没有
 * 焦点」在地址栏里一眼可见。
 */
export function serializeViewState(state: ViewState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.focus !== null) params.set('focus', state.focus);
  if (state.hops === null) {
    // 有焦点但想看全图时，必须显式写 all —— 否则会被解析回「有焦点=两跳」
    if (state.focus !== null) params.set('hops', HOPS_ALL);
  } else {
    params.set('hops', String(clampHops(state.hops)));
  }
  if (state.mode !== 'graph') params.set('view', state.mode);
  return params;
}

/** 视图状态 → `/map?...` 路径。空 query 时不带问号。 */
export function viewHref(state: ViewState): string {
  const query = serializeViewState(state).toString();
  return query.length > 0 ? `/map?${query}` : '/map';
}

/**
 * `+1 跳` / `−1 跳` / `回全图` 三个按钮的下一个状态。
 *
 * 抽成纯函数是因为它们有非平凡的前置条件：从「全图」按 `+1 跳` 该回到两跳
 * （需要一个焦点），没有焦点时这两个按钮必须禁用。判定散在 JSX 里很容易
 * 出现「按钮亮着但点了没反应」。
 */
export function nextHops(state: ViewState, delta: 1 | -1): ViewState {
  if (state.focus === null) return state;
  // 全图状态下「+1」= 回到默认的两跳视野
  if (state.hops === null) return delta === 1 ? { ...state, hops: DEFAULT_HOPS } : state;
  const hops = clampHops(state.hops + delta);
  // 加到头就切全图：`6 跳` 与「全图」在 2000 节点规模下已经是同一件事，
  // 但按钮写着「+1 跳」却什么都没变化是更糟的体验。
  if (hops === state.hops) return state;
  return { ...state, hops };
}

/**
 * `−1 跳` 是否还能按。
 *
 * `0 跳` 已经是最紧的视野（只看焦点自己），再减就没有意义 —— 想放宽请用
 * 「回全图」按钮。这里和 `nextHops` 的判据必须一致，否则会出现「按钮亮着但
 * 点了没反应」。
 */
export function canZoomOutHops(state: ViewState): boolean {
  return state.focus !== null && state.hops !== null && state.hops > 0;
}

/** `+1 跳` 是否还能按。 */
export function canZoomInHops(state: ViewState): boolean {
  return state.focus !== null && (state.hops === null || state.hops < 6);
}

/** 切视图时保留焦点与跳数 —— 票 03 第 5 条「切换后当前位置不丢」。 */
export function withMode(state: ViewState, mode: ViewMode): ViewState {
  return { ...state, mode };
}

/**
 * 当前视野的自然语言描述，给顶栏与 `aria-live` 用。
 *
 * 屏幕阅读器用户看不到「画布上现在是 13 个点」，所以这句话必须同时说明
 * 视野范围与节点数 —— 它是画布内容的主要可访问替代。
 */
export function describeView(state: ViewState, nodeCount: number, focusName: string | null): string {
  const scope =
    state.focus === null || focusName === null
      ? '全图'
      : state.hops === null
        ? `${focusName} 的全图`
        : `${focusName} 的 ${state.hops} 跳邻域`;
  const view = state.mode === 'mainline' ? '线性主线' : '图谱';
  return `${view} · ${scope} · ${nodeCount} 个微知识点`;
}
