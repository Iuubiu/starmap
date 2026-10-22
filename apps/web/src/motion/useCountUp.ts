import { useEffect, useRef, useState } from 'react';
import { easeOutProgress, resolveDuration, standard } from './tokens';
import { useReducedMotion } from './useReducedMotion';

/** `useCountUp` 的可选参数。 */
export interface CountUpOptions {
  /** 一次滚动**期望**的时长（毫秒）。实际时长由 `resolveDuration` 决定。 */
  ms?: number;
}

/**
 * 把数字变化做成滚动，而不是直接跳。
 *
 * 用于「今天答了 12 题」「掌握度 37%」这类**会变的数**。条形的宽度变化和数字
 * 同时跳会让人分不清是「值变了」还是「界面重排了」；数字滚动给一个可追踪的
 * 中间过程，眼睛能跟住。
 *
 * ## 为什么返回值不总是 `state`
 *
 * `prefers-reduced-motion` 下要求**首帧就是终值**：不能先渲染 0、再在
 * `useEffect` 里跳到 1234。那也是一次运动，只不过被压缩成了一帧——对前庭
 * 敏感的用户来说，一次 0→1234 的闪烁和一段 200ms 的滚动是同一类刺激。
 *
 * 所以 reduced 分支不是「把时长设成 0」，而是**在渲染阶段直接短路**：
 * `reduced ? value : displayed`。这样无论第几次渲染、`value` 什么时候变，
 * 返回的都是终值，不依赖任何副作用。
 *
 * ## 为什么 reduced 下连 `setState` 都不发
 *
 * 副作用里只对齐 `fromRef`，不改 state。少一次重渲染是次要的，主要的是：
 * 验收要求「不发任何 rAF」，而「发了 rAF 但立刻结束」在 spy 里同样是 1 次
 * 调用。把整条路径从副作用里摘掉，这个不变量就变成了结构性的，不靠断言守。
 *
 * @param value 目标数值
 * @param options 时长覆盖
 * @returns 当前应显示的数值
 */
export function useCountUp(value: number, options: CountUpOptions = {}): number {
  const reduced = useReducedMotion();
  const requestedMs = options.ms ?? standard;

  // 首次挂载：非 reduced 时从 0 滚上来（这就是「count up」本身）；
  // reduced 时初值直接是终值，配合下面的渲染期短路，首帧即终值。
  const [displayed, setDisplayed] = useState(() => (reduced ? value : 0));

  /**
   * 上一帧的落点。用 ref 而不是读 `displayed`：动画途中 `value` 再次变化时，
   * 必须从**当前显示的值**接着滚，而不是从上一次的目标值跳回去。
   */
  const fromRef = useRef(reduced ? value : 0);

  useEffect(() => {
    const ms = resolveDuration(requestedMs, reduced);

    if (ms === 0) {
      // 不发 rAF、不建动画、不 setState：只记下落点，供下次真的能动时接着滚。
      fromRef.current = value;
      return;
    }

    const from = fromRef.current;
    if (from === value) {
      // 值没变（例如父组件重渲染），别自导自演一段 0 距离的动画。
      setDisplayed(value);
      return;
    }

    let alive = true;
    const startedAt = performance.now();
    let frame = 0;

    const tick = () => {
      // `alive` 不只是防抖：卸载时 `cancelAnimationFrame` 会拦下已排队的回调，
      // 但如果回调已经被取出、正在执行，取消是无效的——那时唯一能拦住
      // setState 的就是这个标志。
      if (!alive) return;

      // 刻意**不用** rAF 回调参数里的时间戳，而是重新读一次 `performance.now()`。
      //
      // 两者在真实浏览器里同源，混用看不出问题；但在 jsdom 里 rAF 时间戳来自
      // 另一条时间线（实测 `performance.now()` 已到 1229ms 时，rAF 参数还是
      // 292ms）。混用的后果不是报错，而是 `elapsed` 恒为负数、动画永远停在
      // 起点——测试里表现为「数字一直是 0」，而且只有真的去断言中间帧才会
      // 发现。同一个时钟从头用到尾，这个坑就不存在。
      const elapsed = performance.now() - startedAt;
      if (elapsed >= ms) {
        fromRef.current = value;
        setDisplayed(value);
        return;
      }

      const progress = easeOutProgress(elapsed / ms);
      setDisplayed(from + (value - from) * progress);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  }, [value, reduced, requestedMs]);

  return reduced ? value : displayed;
}
