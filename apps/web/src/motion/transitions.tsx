/**
 * 阶段转场的**执行层**（票 t60）。
 *
 * ## 这一层和 `theme/motion.ts` 是什么关系
 *
 * `theme/motion.ts` 是 t58 留下的接线面：它认识 React Router，用
 * `useStageNavigate()` 包住一次 `navigate()`。本文件**不认识路由**——它只认
 * 「一段要同步提交的更新 + 这次该往哪个方向走」。这样它能在 jsdom 里被单测
 * 穷举（没有 router、没有页面），也能被 `useRouteTransition()` 包成接缝要的
 * 那一个 `run(fn)`。
 *
 * 层级判断（`/map` = 1、`/map/:id` = 2、`/level/:id` = 3）在这里是**一份拷贝**：
 * `motion/` 刻意不 import `theme/`（t58 的文件），否则动效底座会反向依赖主题层，
 * 而主题层又 import 了 router，`motion/` 的单测就被拽进路由的运行时。代价是
 * 两份判断可能走样——`motion.test.ts` 用一张路径表同时跑两份实现，走样会红。
 *
 * ## 为什么降级是 200ms 的 scale+opacity，而不是「什么都不动」
 *
 * 没有 View Transitions 的浏览器（Firefox 到 2026 年仍未默认开启）里，页面
 * 是**瞬间**换掉的。瞬间换掉不是错误，但它丢掉了一件事：新旧两屏之间没有
 * 公共锚点，学习者得重新找方位。200ms 的「从 0.985 推到 1 + 0.6 淡入」成本
 * 极低（纯合成层），却给了眼睛一个「刚才那一屏被推进来了」的交代。
 *
 * 注意它**不是交叉淡入淡出**：旧屏不会被拍成快照再淡出（那需要 VT），新屏
 * 也不从 0 开始——0.6 的不透明度下限保证任何时刻都看得见内容，不存在白屏。
 */

import { easeEnter, resolveDuration, standard } from './tokens';

/** 转场的三种镜头运动。`none` = 同层级切换，不做缩放。 */
export type StageTransitionKind = 'zoom-in' | 'zoom-out' | 'none';

/**
 * 写在 `<html>` 上的转场类型标记。
 *
 * 与 `theme/motion.css` 的 `:root[data-sm-transition='zoom-in']` 共用同一个
 * 属性名——属性是**跨模块契约**，所以这里 export 出去，让测试断言字符串而
 * 不是手抄。
 */
export const TRANSITION_ATTR = 'data-sm-transition';

/** 兜底动画的起始不透明度下限。0.6 保证任何一帧都看得清内容（不白屏）。 */
export const FALLBACK_OPACITY_FLOOR = 0.6;

/** 兜底动画的起始缩放。0.985 = 0.015 的推近，肉眼刚好能感到「动了一下」。 */
export const FALLBACK_SCALE_FROM = 0.985;

/** 浏览器对 View Transitions 的最小面。导出给测试伪造。 */
export interface ViewTransitionLike {
  readonly finished: Promise<void>;
  readonly ready: Promise<void>;
  readonly updateCallbackDone: Promise<void>;
  skipTransition(): void;
}

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => ViewTransitionLike;
};

/**
 * 路径的「深度」。
 *
 * 与 `theme/motion.ts` 的 `stageTransitionKind` 同一套空间模型（SKILL.md §3.4）：
 * 越深越近。这里单独导出是为了让测试能分别验证「深度」与「方向」，也为了让
 * 两处实现的对照测试能直接比数字。
 */
export function stageDepth(path: string): number {
  if (path.startsWith('/level/')) return 3;
  if (path.startsWith('/map/')) return 2;
  if (path === '/map') return 1;
  return 0;
}

/**
 * 判断一次导航是「钻进去」还是「退出来」。
 *
 * 只看**层级**，不看 id：两个节点详情之间是横向移动，不该缩放——缩放一个
 * 没有纵深变化的切换，会让学习者以为自己进错了层。
 */
export function stageTransitionKind(from: string, to: string): StageTransitionKind {
  const a = stageDepth(from);
  const b = stageDepth(to);
  if (a === 0 || b === 0) return 'none';
  if (b > a) return 'zoom-in';
  if (b < a) return 'zoom-out';
  return 'none';
}

/** 当前环境是否真的能跑 View Transitions（jsdom 里没有）。 */
export function supportsViewTransitions(): boolean {
  if (typeof document === 'undefined') return false;
  return typeof (document as DocumentWithViewTransition).startViewTransition === 'function';
}

export interface StageTransitionOptions {
  /** 镜头方向。默认 `zoom-in`：本接缝的用途是阶段推进（地图 → 近景）。 */
  readonly kind?: StageTransitionKind;
  /** 用户是否要求减少动效。为真时**同步**执行更新、不建任何动画。 */
  readonly reduced?: boolean;
  /** 兜底动画的作用对象。默认 `#root`，没有则 `documentElement`。 */
  readonly target?: Element | null;
  /** 兜底时长（毫秒），默认 `standard`（200ms），会被 `resolveDuration` 夹取。 */
  readonly fallbackMs?: number;
}

export type StageTransitionOutcome = 'view-transition' | 'fallback' | 'instant';

function resolveTarget(target: Element | null | undefined): Element | null {
  if (target !== undefined) return target;
  if (typeof document === 'undefined') return null;
  return document.getElementById('root') ?? document.documentElement;
}

/**
 * 兜底动画的关键帧：**只有** transform 与 opacity。
 *
 * 特意导出：单测要断言「透明度永远不会到 0」与「没有动 layout 属性」。这两条
 * 一旦破了，降级路径就会从「便宜的推近」变成「一次白屏 + 一次重排」。
 */
export function fallbackKeyframes(): Keyframe[] {
  return [
    { opacity: FALLBACK_OPACITY_FLOOR, transform: `scale(${FALLBACK_SCALE_FROM})` },
    { opacity: 1, transform: 'scale(1)' },
  ];
}

/**
 * 播一次 200ms 的 scale+opacity 入场。
 *
 * 只承诺「尽力而为」：`Element.animate` 不存在（jsdom）时直接 resolve——
 * 没有动画也是完整可用的界面，抛错只会把一次降级变成一次白屏。
 */
export async function playScaleOpacityFallback(
  target: Element | null,
  options: { ms?: number } = {},
): Promise<boolean> {
  const ms = options.ms ?? standard;
  if (target === null || ms <= 0) return false;
  const animate = (target as Element & { animate?: Element['animate'] }).animate;
  if (typeof animate !== 'function') return false;

  const animation = target.animate(fallbackKeyframes(), {
    duration: ms,
    easing: easeEnter,
    fill: 'both',
  });
  try {
    await animation.finished;
  } catch {
    // `Animation.finished` 在被取消时 reject。取消不是错误：转场被更快的下一次
    // 转场顶掉是常态，不该冒泡成未捕获异常。
  } finally {
    // 结束帧与自然样式完全一致，取消不会有视觉变化，却能让
    // `document.getAnimations()` 回到空——reduce 门禁依赖这个不变量。
    animation.cancel();
  }
  return true;
}

/**
 * 执行一次阶段转场。
 *
 * 三种结局：
 * - `instant`：reduced、或 `kind === 'none'`。更新**同步**完成，零动画。
 * - `view-transition`：浏览器支持 VT。旧屏被浏览器拍成快照，新屏在快照下面
 *   提交，`::view-transition-*` 的缩放由 `theme/motion.css` 按
 *   `[data-sm-transition]` 选档。整段路径**没有白屏**：快照一直在最上层。
 * - `fallback`：没有 VT。先提交更新，再把新内容按 200ms 从 0.985/0.6 推到位。
 *
 * 起手失败（`startViewTransition` 抛，例如被权限策略禁用）也走 `fallback`：
 * 转场是装饰，**不能**因为它失败而让导航不发生。
 */
export async function runStageTransition(
  update: () => void | Promise<void>,
  options: StageTransitionOptions = {},
): Promise<StageTransitionOutcome> {
  const reduced = options.reduced ?? false;
  const kind = options.kind ?? 'zoom-in';
  const fallbackMs = resolveDuration(options.fallbackMs ?? standard, reduced);

  // reduce 与同层切换：一次跳变。**不建** VT、**不建** WAAPI，页面仍然更新。
  if (reduced || kind === 'none') {
    await update();
    return 'instant';
  }

  const doc = typeof document === 'undefined' ? null : (document as DocumentWithViewTransition);
  const start = doc?.startViewTransition;
  const target = resolveTarget(options.target);

  if (doc === null || typeof start !== 'function') {
    await update();
    const played = await playScaleOpacityFallback(target, { ms: fallbackMs });
    return played ? 'fallback' : 'instant';
  }

  const root = doc.documentElement;
  const previous = root.getAttribute(TRANSITION_ATTR);
  root.setAttribute(TRANSITION_ATTR, kind);

  /** 恢复到转场前的属性状态。`null` 表示本来就该没有。 */
  const restore = (): void => {
    if (previous === null) root.removeAttribute(TRANSITION_ATTR);
    else root.setAttribute(TRANSITION_ATTR, previous);
  };

  // 更新回调里抛出的错要能被调用方看见（那是产品 bug，不是转场失败）。
  // VT 自己的失败（被下一次导航顶掉、skipTransition）则必须吞掉。
  let updateError: unknown = null;

  let transition: ViewTransitionLike;
  try {
    transition = start.call(doc, () => {
      try {
        return update();
      } catch (cause) {
        updateError = cause;
        throw cause;
      }
    });
  } catch {
    // 起手就失败：退回兜底，**更新照做**。
    restore();
    await update();
    const played = await playScaleOpacityFallback(target, { ms: fallbackMs });
    return played ? 'fallback' : 'instant';
  }

  try {
    await transition.updateCallbackDone;
    // 等整段动画放完再摘属性：中途摘掉会让「已经开始的动画」与「样式表里
    // 的选档」短暂不一致，DevTools 里看起来像转场被打断。
    await transition.finished.catch(() => {});
    return 'view-transition';
  } catch (cause) {
    if (updateError !== null) throw updateError;
    throw cause;
  } finally {
    restore();
  }
}
