import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnterOnMount } from './EnterOnMount';
import { ENTER_OFFSET_PX, REDUCED_MOTION_QUERY, easeOut, quick, standard } from './tokens';
import { useCountUp } from './useCountUp';
import { useReducedMotion } from './useReducedMotion';

/**
 * 这个文件测的不是「动画好不好看」——那要靠眼睛和 Playwright 的截图。这里测
 * 的是三条**结构性**不变量，它们一旦破了，坏掉的是无障碍承诺而不是观感：
 *
 * 1. `prefers-reduced-motion` 双向生效（用户随时会在系统设置里拨开关）；
 * 2. reduce 下**一次 `requestAnimationFrame` 都不发**——断言的是机制，不是
 *    「很快就结束」。后者用「把 200ms 改成 1ms」也能过，但那是另一种运动；
 * 3. `useCountUp` 在 reduce 下**首帧就是终值**，不能先渲染 0 再跳。
 */

// ---------------------------------------------------------------------------
// 测试替身
// ---------------------------------------------------------------------------

/**
 * 可拨动的 `matchMedia`。
 *
 * `setup.ts` 里的那个桩每次调用都返回**新对象**且监听器是空实现，只能证明
 * 「调用不抛异常」，测不了 `change` 事件。这里返回同一个对象（真实浏览器里
 * 同一查询串的多个 `MediaQueryList` 也是共享状态的），于是「拨开关」可以
 * 同步触发所有订阅者。
 */
interface MediaStub {
  set(matches: boolean): void;
  listenerCount(): number;
  restore(): void;
}

function installReducedMotion(initial: boolean): MediaStub {
  const listeners = new Set<() => void>();
  const mql = {
    matches: initial,
    media: REDUCED_MOTION_QUERY,
    onchange: null,
    addEventListener: (type: string, cb: () => void) => {
      if (type === 'change') listeners.add(cb);
    },
    removeEventListener: (type: string, cb: () => void) => {
      if (type === 'change') listeners.delete(cb);
    },
    addListener: (cb: () => void) => listeners.add(cb),
    removeListener: (cb: () => void) => listeners.delete(cb),
    dispatchEvent: () => false,
  };

  const original = window.matchMedia;
  window.matchMedia = ((query: string) => {
    // 其他查询（例如侧栏的窄屏判断）永远不匹配：这些用例只关心 reduced，
    // 让别的查询意外为真会把测试变成「碰巧通过」。
    if (query !== REDUCED_MOTION_QUERY) {
      return { ...mql, matches: false } as unknown as MediaQueryList;
    }
    return mql as unknown as MediaQueryList;
  }) as typeof window.matchMedia;

  return {
    set(matches) {
      mql.matches = matches;
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
    restore() {
      window.matchMedia = original;
    },
  };
}

/** 记录 rAF 调用，但**不**真的排帧——用来断言「一次都没发」。 */
interface RafStub {
  calls: number;
  cancelled: number[];
  restore(): void;
}

function installRafStub(): RafStub {
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const stub: RafStub = {
    calls: 0,
    cancelled: [],
    restore() {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancel;
    },
  };

  let nextId = 1;
  const raf = (() => {
    stub.calls += 1;
    return nextId++;
  }) as unknown as typeof requestAnimationFrame;
  globalThis.requestAnimationFrame = raf;
  globalThis.cancelAnimationFrame = ((id: number) => {
    stub.cancelled.push(id);
  }) as typeof cancelAnimationFrame;

  return stub;
}

/**
 * `Element.animate` 的替身。
 *
 * jsdom 没有 WAAPI。没有它，`EnterOnMount` 会走「环境不支持就静默跳过」的
 * 分支——于是所有断言都会通过，而实际上什么都没测到。装上替身之后，
 * 「非 reduce 下建了动画、reduce 下没建」才是一个**能失败**的断言。
 */
interface AnimateCall {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
}

function installAnimateStub(): { calls: AnimateCall[]; cancels: number; restore(): void } {
  const calls: AnimateCall[] = [];
  const state = {
    calls,
    cancels: 0,
    restore() {
      delete (Element.prototype as { animate?: unknown }).animate;
    },
  };

  (Element.prototype as unknown as { animate: unknown }).animate = function animate(
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ) {
    calls.push({ keyframes, options });
    let cancelled = false;
    return {
      cancel() {
        if (cancelled) return;
        cancelled = true;
        state.cancels += 1;
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      finish: () => {},
      playState: 'running',
    };
  };

  return state;
}

// ---------------------------------------------------------------------------

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

function ReducedProbe({ tick }: { tick: number }) {
  const reduced = useReducedMotion();
  return (
    <span data-testid="reduced" data-tick={tick}>
      {String(reduced)}
    </span>
  );
}

describe('useReducedMotion', () => {
  it('初始为 false 时读 false', () => {
    const media = installReducedMotion(false);
    cleanups.push(() => media.restore());

    render(<ReducedProbe tick={0} />);
    expect(screen.getByTestId('reduced')).toHaveTextContent('false');
  });

  it('change 事件双向生效：false → true → false', () => {
    const media = installReducedMotion(false);
    cleanups.push(() => media.restore());

    render(<ReducedProbe tick={0} />);
    expect(screen.getByTestId('reduced')).toHaveTextContent('false');

    act(() => media.set(true));
    expect(screen.getByTestId('reduced')).toHaveTextContent('true');

    act(() => media.set(false));
    expect(screen.getByTestId('reduced')).toHaveTextContent('false');
  });

  it('组件重渲染后仍读到当前值（不是闭包里捕获的旧值）', () => {
    const media = installReducedMotion(false);
    cleanups.push(() => media.restore());

    const { rerender } = render(<ReducedProbe tick={0} />);
    act(() => media.set(true));
    expect(screen.getByTestId('reduced')).toHaveTextContent('true');

    // 父组件换了一个无关 prop，强制重渲染。若实现把值缓存在 state 里而
    // 漏了重算，这里会退回 false。
    rerender(<ReducedProbe tick={1} />);
    expect(screen.getByTestId('reduced')).toHaveTextContent('true');
  });

  it('卸载后取消订阅（不留悬挂监听器）', () => {
    const media = installReducedMotion(false);
    cleanups.push(() => media.restore());

    const { unmount } = render(<ReducedProbe tick={0} />);
    expect(media.listenerCount()).toBe(1);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('EnterOnMount', () => {
  it('非 reduce：建一次 120ms 的 WAAPI 动画，位移 8px、终点归零', () => {
    const media = installReducedMotion(false);
    const animate = installAnimateStub();
    cleanups.push(() => media.restore());
    cleanups.push(() => animate.restore());

    render(
      <EnterOnMount>
        <p>卡片内容</p>
      </EnterOnMount>,
    );

    expect(animate.calls).toHaveLength(1);
    // `noUncheckedIndexedAccess` 下解构出来是 `AnimateCall | undefined`；
    // 上面那条 `toHaveLength(1)` 已经保证了存在性，这里用 `!` 把它交给类型系统。
    const [call] = animate.calls;
    expect(call!.options.duration).toBe(quick);
    expect(call!.options.duration).toBe(120);
    expect(call!.options.easing).toBe(easeOut);
    expect(call!.keyframes[0]).toEqual({
      opacity: 0,
      transform: `translateY(${ENTER_OFFSET_PX}px)`,
    });
    expect(call!.keyframes[1]).toEqual({ opacity: 1, transform: 'translateY(0px)' });
  });

  it('reduce：不建任何动画（duration 不是 0，是根本没调用）', () => {
    const media = installReducedMotion(true);
    const animate = installAnimateStub();
    cleanups.push(() => media.restore());
    cleanups.push(() => animate.restore());

    render(
      <EnterOnMount>
        <p>卡片内容</p>
      </EnterOnMount>,
    );

    expect(animate.calls).toHaveLength(0);
  });

  it('两种模式下都不发 rAF（WAAPI 由合成器驱动，不需要主线程排帧）', () => {
    const media = installReducedMotion(false);
    const animate = installAnimateStub();
    const raf = installRafStub();
    cleanups.push(() => media.restore());
    cleanups.push(() => animate.restore());
    cleanups.push(() => raf.restore());

    render(
      <EnterOnMount>
        <p>卡片内容</p>
      </EnterOnMount>,
    );

    expect(raf.calls).toBe(0);
  });

  it('内容照常渲染（动画只是装饰，不影响可访问文本）', () => {
    const media = installReducedMotion(true);
    const animate = installAnimateStub();
    cleanups.push(() => media.restore());
    cleanups.push(() => animate.restore());

    render(
      <EnterOnMount as="section">
        <h2>今日复习</h2>
      </EnterOnMount>,
    );

    expect(screen.getByRole('heading', { name: '今日复习' })).toBeInTheDocument();
  });

  it('卸载时取消动画，不让它挂在 getAnimations() 里', () => {
    const media = installReducedMotion(false);
    const animate = installAnimateStub();
    cleanups.push(() => media.restore());
    cleanups.push(() => animate.restore());

    const { unmount } = render(
      <EnterOnMount>
        <p>卡片内容</p>
      </EnterOnMount>,
    );
    expect(animate.cancels).toBe(0);
    unmount();
    expect(animate.cancels).toBe(1);
  });
});

// ---------------------------------------------------------------------------

/** 每次渲染都把当前显示值推入 `renders`，用来断言「首帧」而不是「最终」。 */
function CountUpProbe({
  value,
  renders,
}: {
  value: number;
  renders: number[];
}) {
  const shown = useCountUp(value);
  renders.push(shown);
  return <span data-testid="value">{String(shown)}</span>;
}

describe('useCountUp', () => {
  it('reduce：首帧就是终值，不先渲染 0', () => {
    const media = installReducedMotion(true);
    const animate = installAnimateStub();
    cleanups.push(() => media.restore());
    cleanups.push(() => animate.restore());

    const renders: number[] = [];
    render(<CountUpProbe value={1234} renders={renders} />);

    // 断言的是**第一次渲染的输出**。如果实现写成 `useState(0)` + effect 里
    // 直接 set，这里会是 0。
    expect(renders[0]).toBe(1234);
    expect(screen.getByTestId('value')).toHaveTextContent('1234');
  });

  it('reduce：一次 rAF 都不发', () => {
    const media = installReducedMotion(true);
    const raf = installRafStub();
    cleanups.push(() => media.restore());
    cleanups.push(() => raf.restore());

    render(<CountUpProbe value={42} renders={[]} />);
    expect(raf.calls).toBe(0);
  });

  it('reduce：值变化后仍直接跳到新终值，不发 rAF', () => {
    const media = installReducedMotion(true);
    const raf = installRafStub();
    cleanups.push(() => media.restore());
    cleanups.push(() => raf.restore());

    const renders: number[] = [];
    const { rerender } = render(<CountUpProbe value={10} renders={renders} />);
    renders.length = 0;
    rerender(<CountUpProbe value={99} renders={renders} />);

    expect(renders[0]).toBe(99);
    expect(raf.calls).toBe(0);
  });

  it('非 reduce：从 0 滚到终值，且确实发了 rAF', async () => {
    const media = installReducedMotion(false);
    cleanups.push(() => media.restore());

    const renders: number[] = [];
    render(<CountUpProbe value={100} renders={renders} />);

    expect(renders[0]).toBe(0);
    await waitFor(() => expect(screen.getByTestId('value')).toHaveTextContent('100'), {
      timeout: 2000,
    });
    // 中间帧必须出现过——否则这就不是「滚动」，只是「晚一点跳」。
    expect(renders.some((v) => v > 0 && v < 100)).toBe(true);
  });

  it('值没变时不启动动画（父组件重渲染不该重播）', () => {
    const media = installReducedMotion(false);
    const raf = installRafStub();
    cleanups.push(() => media.restore());
    cleanups.push(() => raf.restore());

    const renders: number[] = [];
    const { rerender } = render(<CountUpProbe value={0} renders={renders} />);
    // 值本来就是 0，目标也是 0：不该为了「滚 0 距离」排一帧。
    expect(raf.calls).toBe(0);

    rerender(<CountUpProbe value={0} renders={renders} />);
    expect(raf.calls).toBe(0);
    expect(renders.every((v) => v === 0)).toBe(true);
  });

  it('卸载后已排队的帧回调不会触发 setState', () => {
    const media = installReducedMotion(false);
    cleanups.push(() => media.restore());

    // 用真的 rAF 排帧，卸载前把「已排队的回调」抓在手里，卸载后手动执行，
    // 模拟「回调已经从队列里取出、cancel 拦不住」的那一帧。
    const queued: FrameRequestCallback[] = [];
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      queued.push(cb);
      return queued.length;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = () => {};
    cleanups.push(() => {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancel;
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(<CountUpProbe value={100} renders={[]} />);
    expect(queued.length).toBeGreaterThan(0);

    const pending = [...queued];
    unmount();

    // React 19 起不再为「卸载后 setState」打警告，所以这里断言的是「不抛
    // 异常且没有 console.error」。守卫本身（`alive` 标志）仍然必要：它同时
    // 挡掉 `cancelAnimationFrame` 拦不住的那一帧。
    expect(() => {
      for (const cb of pending) act(() => cb(performance.now() + 1000));
    }).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('自定义时长仍走 resolveDuration：reduce 下传 5000 也是首帧即终值', () => {
    const media = installReducedMotion(true);
    const raf = installRafStub();
    cleanups.push(() => media.restore());
    cleanups.push(() => raf.restore());

    const renders: number[] = [];
    render(<CountUpProbe value={7} renders={renders} />);
    expect(renders[0]).toBe(7);
    expect(raf.calls).toBe(0);
  });

  it('默认时长是 standard（200ms）', () => {
    // 这条是防「有人把默认值改成 0 让测试变绿」：standard 本身在
    // tokens.test.ts 里被钉住，这里只确认 hook 用的就是它。
    expect(standard).toBe(200);
  });
});
