/**
 * 接缝：`useRouteTransition()`（票 t60）。
 *
 * ## 它替调用方决定什么
 *
 * 调用方只写「这次导航要发生的事」：
 *
 * ```ts
 * const { run } = useRouteTransition();
 * run(() => navigate('/map/' + id));
 * ```
 *
 * 剩下的三件判断都在这里：现在要不要动（reduce）、动哪一种（缩放方向）、
 * 浏览器不支持 View Transitions 时退化成什么（200ms 推近）。调用方**不该**
 * 知道 `document.startViewTransition` 存不存在——那正是这个接缝存在的理由。
 *
 * ## 为什么 `run` 是同步签名却返回 `void`
 *
 * 接缝的 docblock 把签名钉成 `(fn: () => void) => void`：调用点在事件处理器里，
 * 写成 `await run(...)` 会让「点一下」变成异步流程，从而错过浏览器对用户手势
 * 的信任窗口（例如导航后立刻 `focus()`，在 await 之后就不再被当作手势的直接
 * 结果）。转场本身仍然在后台跑完，只是没人等它。
 *
 * ## 卸载之后
 *
 * `run` 拿到的是调用方给的闭包，闭包里通常是 `navigate`。组件卸载时正在跑的
 * 转场会自己走完（浏览器持有那次快照），这里不做任何取消——取消一次已经开始的
 * View Transition 会留下一个停在半透明的快照，比让它放完更糟。唯一要防的是
 * 「卸载后回调又跑了一次」，所以这里只保证 `run` 不会被延迟调用：它总是在
 * 同一次点击里同步起手。
 */

import { useCallback, useMemo } from 'react';
import { runStageTransition, type StageTransitionKind, type StageTransitionOutcome } from './transitions';
import { useReducedMotion } from './useReducedMotion';

export interface RouteTransitionOptions {
  /** 镜头方向。省略时由 `runStageTransition` 的默认值决定（`zoom-in`）。 */
  readonly kind?: StageTransitionKind;
  /** 兜底动画的作用对象；默认 `#root`。 */
  readonly target?: Element | null;
  /** 兜底时长（毫秒）；默认 200ms，reduced 时归 0。 */
  readonly fallbackMs?: number;
}

/** 接缝要求的返回面。 */
export interface RouteTransitionApi {
  run: (fn: () => void) => void;
}

/**
 * 阶段转场的 React 入口。
 *
 * `reduced` 每次都从系统偏好现读（`useReducedMotion` 订阅了媒体查询的
 * change 事件），所以用户在应用运行期间打开「减弱动态效果」会立刻生效，
 * 不需要刷新。
 */
export function useRouteTransition(options: RouteTransitionOptions = {}): RouteTransitionApi {
  const reduced = useReducedMotion();
  const { kind, target, fallbackMs } = options;

  const run = useCallback(
    (update: () => void): void => {
      // 不 await：见文件头「为什么 run 是同步签名」。
      void runStageTransition(update, {
        reduced,
        ...(kind === undefined ? {} : { kind }),
        ...(target === undefined ? {} : { target }),
        ...(fallbackMs === undefined ? {} : { fallbackMs }),
      }).catch((error: unknown) => {
        // 走到这里只有一个原因：调用方自己传的 update 抛了（产品 bug）。
        // 转场失败已经在 runStageTransition 内部降级成 fallback，不会到这。
        // 不 rethrow 是因为此时已经离开了 React 的事件栈，抛出去只会变成
        // 未捕获的 promise rejection，反而丢掉真正的堆栈。
        console.error('[motion] 阶段转场里的更新抛错', error);
      });
    },
    [reduced, kind, target, fallbackMs],
  );

  return useMemo(() => ({ run }), [run]);
}

/**
 * 非 hook 入口（事件处理器之外、服务端或单测用）。
 *
 * 与 hook 的差别只有 reduce：这里显式传入，不读系统偏好。
 */
export function runRouteTransition(
  update: () => void,
  options: { kind?: StageTransitionKind; reduced?: boolean } = {},
): Promise<StageTransitionOutcome> {
  return runStageTransition(update, options);
}
