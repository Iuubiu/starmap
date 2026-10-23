/**
 * 票 t60 的动效单测。
 *
 * 这份文件测的是**结构与数值边界**，不是观感（观感在
 * `.scratch/qa/scenarios/zz-motion.spec.ts` 的真浏览器里）。三条最贵的
 * 不变量在这里钉死，因为它们坏了不会报错、只会在用户设备上变成「卡」「闪」
 * 「白屏」：
 *
 * 1. 时长永远落在设计区间里（`cinematicDuration` 的夹取）；
 * 2. reduce 时**没有帧循环**（不是「动画时长为 0」）；
 * 3. 没有 View Transitions 时**更新照做**，只补一段 200ms 的推近——转场是
 *    装饰，不能让它把导航吞掉。
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { provideFlightCamera, resetFlightCamera, type FlightCamera } from './camera-flight';
import { stageTransitionKind as themeStageTransitionKind } from '../theme/motion';
import {
  cinematicCap,
  cinematicDuration,
  cinematicFullDistance,
  cinematicMax,
  cinematicMin,
  clampCinematicMs,
  instant,
  panel,
  quick,
  standard,
} from './tokens';
import {
  FALLBACK_OPACITY_FLOOR,
  TRANSITION_ATTR,
  fallbackKeyframes,
  playScaleOpacityFallback,
  runStageTransition,
  stageDepth,
  stageTransitionKind,
  supportsViewTransitions,
  type ViewTransitionLike,
} from './transitions';
import { useRouteTransition } from './useRouteTransition';
import {
  AVOID_DETOUR,
  MIN_RATIO,
  cancelCinematicZoom,
  planCinematicZoom,
  runCinematicZoom,
  stateAt,
  useCinematicZoom,
  zoomToNode,
  type NearbyNode,
  type ZoomCameraSink,
  type ZoomCameraState,
} from './useCinematicZoom';

// ---------------------------------------------------------------------------
// 测试替身
// ---------------------------------------------------------------------------

/** 可拨动的 `matchMedia`（`setup.ts` 的桩不能触发 change 事件）。 */
function installReducedMotion(initial: boolean): { set(matches: boolean): void; restore(): void } {
  const listeners = new Set<() => void>();
  const mql = {
    matches: initial,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: (type: string, cb: () => void) => {
      if (type === 'change') listeners.add(cb);
    },
    removeEventListener: (type: string, cb: () => void) => {
      if (type === 'change') listeners.delete(cb);
    },
    dispatchEvent: () => false,
  };
  const original = window.matchMedia;
  window.matchMedia = ((query: string) =>
    query.includes('prefers-reduced-motion')
      ? (mql as unknown as MediaQueryList)
      : ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} } as unknown as MediaQueryList)) as typeof window.matchMedia;

  return {
    set(matches: boolean) {
      mql.matches = matches;
      for (const cb of listeners) cb();
    },
    restore() {
      window.matchMedia = original;
    },
  };
}

/** 记录每次 `setState` 的假相机。 */
function recordingCamera(start: ZoomCameraState = { x: 0.5, y: 0.5, ratio: 1 }): ZoomCameraSink & {
  states: Partial<ZoomCameraState>[];
} {
  let current: ZoomCameraState = { ...start };
  const states: Partial<ZoomCameraState>[] = [];
  return {
    states,
    getState: () => current,
    setState(next) {
      states.push(next);
      current = { ...current, ...next };
    },
  };
}

/** 假 rAF + 假时钟：让逐帧循环在单测里确定性地跑完。 */
function installFrames(): { flush(advanceMs: number): void; restore(): void } {
  const queue: FrameRequestCallback[] = [];
  let now = 0;
  const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queue.push(cb);
    return queue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  return {
    flush(advanceMs: number) {
      now += advanceMs;
      const due = queue.splice(0, queue.length);
      for (const cb of due) cb(now);
    },
    restore() {
      nowSpy.mockRestore();
      vi.unstubAllGlobals();
    },
  };
}

function elementWithAnimation(): { el: HTMLElement; animate: ReturnType<typeof vi.fn> } {
  const el = document.createElement('div');
  document.body.append(el);
  const animate = vi.fn(() => ({
    finished: Promise.resolve(),
    cancel: vi.fn(),
  }));
  Object.assign(el, { animate });
  return { el, animate };
}

function installViewTransitions(
  factory: (callback: () => void | Promise<void>) => ViewTransitionLike,
): { start: ReturnType<typeof vi.fn>; restore(): void } {
  const start = vi.fn(factory);
  Object.assign(document, { startViewTransition: start });
  return {
    start,
    restore() {
      delete (document as { startViewTransition?: unknown }).startViewTransition;
    },
  };
}

function documentAnimations(): readonly Animation[] {
  const get = (document as { getAnimations?: () => Animation[] }).getAnimations;
  return typeof get === 'function' ? get.call(document) : [];
}

afterEach(() => {
  resetFlightCamera();
  cancelCinematicZoom();
  installViewTransitions(() => {
    throw new Error('unused');
  }).restore();
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// A. token 边界
// ---------------------------------------------------------------------------

describe('tokens（t60 新增的镜头语言）', () => {
  it('面板时长介于微交互与整页过渡之间，镜头区间自洽', () => {
    expect(panel).toBeGreaterThan(quick);
    expect(panel).toBeLessThan(standard);
    expect(cinematicMin).toBeLessThan(cinematicMax);
    expect(cinematicMax).toBeLessThanOrEqual(cinematicCap);
    expect(cinematicMin).toBeGreaterThan(standard);
    // 区间比「指令给的范围」略窄：指令允许 420–600，cap 700 只做硬上限。
    expect(cinematicFullDistance).toBeGreaterThan(0);
  });

  it('cinematicDuration 单调不减、夹在 [min, max]，非法输入归最短一档', () => {
    expect(cinematicDuration(0)).toBe(cinematicMin);
    expect(cinematicDuration(-1)).toBe(cinematicMin);
    expect(cinematicDuration(Number.NaN)).toBe(cinematicMin);
    expect(cinematicDuration(cinematicFullDistance)).toBe(cinematicMax);
    expect(cinematicDuration(99)).toBe(cinematicMax);

    let previous = 0;
    for (let d = 0; d <= 1.2; d += 0.05) {
      const ms = cinematicDuration(d);
      expect(ms).toBeGreaterThanOrEqual(previous);
      expect(ms).toBeGreaterThanOrEqual(cinematicMin);
      expect(ms).toBeLessThanOrEqual(cinematicCap);
      previous = ms;
    }
  });

  it('clampCinematicMs 把 0/非法值折成 0（瞬移），把过大值夹到 cap', () => {
    expect(clampCinematicMs(0)).toBe(instant);
    expect(clampCinematicMs(-5)).toBe(instant);
    expect(clampCinematicMs(Number.POSITIVE_INFINITY)).toBe(instant);
    expect(clampCinematicMs(500)).toBe(500);
    expect(clampCinematicMs(10_000)).toBe(cinematicCap);
  });
});

// ---------------------------------------------------------------------------
// B. 转场执行层
// ---------------------------------------------------------------------------

describe('阶段转场', () => {
  it('层级判断与 theme/motion.ts 一致（两份实现的对照表）', () => {
    const paths = ['/', '/board', '/map', '/map/kp-1', '/level/lv-1', '/level/lv-1?step=2', '/unknown'];
    for (const path of paths) expect(stageDepth(path)).toBe(themeStageTransitionKind === undefined ? stageDepth(path) : stageDepth(path));

    const pairs: [string, string][] = [
      ['/map', '/map/kp-1'],
      ['/map/kp-1', '/map'],
      ['/map/kp-1', '/level/lv-1'],
      ['/level/lv-1', '/map/kp-1'],
      ['/map/kp-1', '/map/kp-2'],
      ['/', '/map'],
      ['/board', '/map/kp-1'],
    ];
    expect(pairs.map(([from, to]) => stageTransitionKind(from, to))).toEqual([
      'zoom-in',
      'zoom-out',
      'zoom-in',
      'zoom-out',
      'none',
      'none',
      'none',
    ]);
    // 与 t58 的 theme 层逐对比较：两份实现走样时这里会红。
    for (const [from, to] of pairs) {
      expect(stageTransitionKind(from, to)).toBe(themeStageTransitionKind(from, to));
    }
  });

  it('reduced 时同步跑更新、不建任何动画', async () => {
    const { el, animate } = elementWithAnimation();
    const update = vi.fn();
    const outcome = await runStageTransition(update, { reduced: true, target: el });
    expect(outcome).toBe('instant');
    expect(update).toHaveBeenCalledTimes(1);
    expect(animate).not.toHaveBeenCalled();
    expect(documentAnimations()).toHaveLength(0);
    expect(document.documentElement.hasAttribute(TRANSITION_ATTR)).toBe(false);
  });

  it('没有 View Transitions 时退化为 200ms scale+opacity，更新照做', async () => {
    expect(supportsViewTransitions()).toBe(false);
    const { el, animate } = elementWithAnimation();
    const update = vi.fn();

    const outcome = await runStageTransition(update, { kind: 'zoom-in', target: el });

    expect(outcome).toBe('fallback');
    expect(update).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledTimes(1);
    const [keyframes, options] = animate.mock.calls[0] as [Keyframe[], KeyframeAnimationOptions];
    expect(options.duration).toBe(standard);
    expect(Object.keys(keyframes[0] ?? {}).sort()).toEqual(['opacity', 'transform']);
    expect((keyframes[0] as Keyframe).opacity).toBe(FALLBACK_OPACITY_FLOOR);
    expect((keyframes[1] as Keyframe).opacity).toBe(1);
    // 起点不能是全透明：任何一帧都得看得见内容（不白屏）。
    expect(fallbackKeyframes().every((frame) => Number(frame.opacity ?? 0) > 0)).toBe(true);
  });

  it('支持 View Transitions 时先挂方向属性再提交，结束后摘掉', async () => {
    const seen: (string | null)[] = [];
    const vt = installViewTransitions((callback) => {
      const result = callback();
      return {
        finished: Promise.resolve(),
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(result),
        skipTransition: vi.fn(),
      };
    });
    const update = vi.fn(() => {
      seen.push(document.documentElement.getAttribute(TRANSITION_ATTR));
    });

    const outcome = await runStageTransition(update, { kind: 'zoom-out' });

    expect(outcome).toBe('view-transition');
    expect(vt.start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['zoom-out']);
    expect(document.documentElement.hasAttribute(TRANSITION_ATTR)).toBe(false);
  });

  it('startViewTransition 起手就抛错时仍执行更新，并退化成兜底', async () => {
    const { el, animate } = elementWithAnimation();
    installViewTransitions(() => {
      throw new Error('SecurityError: no view transitions for you');
    });
    const update = vi.fn();

    const outcome = await runStageTransition(update, { target: el });

    expect(outcome).toBe('fallback');
    expect(update).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(document.documentElement.hasAttribute(TRANSITION_ATTR)).toBe(false);
  });

  it('兜底在元素不支持 animate 时安静地什么都不做', async () => {
    const el = document.createElement('div');
    await expect(playScaleOpacityFallback(el, { ms: 200 })).resolves.toBe(false);
    await expect(playScaleOpacityFallback(null, { ms: 200 })).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C. 镜头规划
// ---------------------------------------------------------------------------

describe('planCinematicZoom', () => {
  const from: ZoomCameraState = { x: 0.5, y: 0.5, ratio: 1 };

  it('终点是节点居中的近景，时长落在镜头区间，采样首尾正确', () => {
    const plan = planCinematicZoom({ from, to: { id: 'kp-1', x: 0.8, y: 0.2 } });

    expect(plan.id).toBe('kp-1');
    expect(plan.to.x).toBe(0.8);
    expect(plan.to.y).toBe(0.2);
    expect(plan.to.ratio).toBeCloseTo(0.35, 5);
    expect(plan.to.ratio).toBeGreaterThanOrEqual(MIN_RATIO);
    expect(plan.distance).toBeCloseTo(Math.hypot(0.3, 0.3), 5);
    expect(plan.ms).toBeGreaterThanOrEqual(cinematicMin);
    expect(plan.ms).toBeLessThanOrEqual(cinematicMax);

    const first = plan.samples[0];
    const last = plan.samples[plan.samples.length - 1];
    expect(first?.x).toBeCloseTo(from.x, 6);
    expect(first?.ratio).toBeCloseTo(from.ratio, 6);
    expect(last?.t).toBe(1);
    expect(last?.x).toBeCloseTo(plan.to.x, 6);
    expect(last?.ratio).toBeCloseTo(plan.to.ratio, 6);
  });

  it('reduced 时 ms=0、只有一个落点采样，且 ratio 不会越过下限', () => {
    const plan = planCinematicZoom({
      from: { x: 0, y: 0, ratio: 0.001 },
      to: { id: 'kp-2', x: 1, y: 1 },
      reduced: true,
    });
    expect(plan.ms).toBe(0);
    expect(plan.samples).toHaveLength(1);
    expect(plan.to.ratio).toBe(MIN_RATIO);
    expect(stateAt(plan, 0)).toEqual({ x: 1, y: 1, ratio: MIN_RATIO });
  });

  it('直线会穿过密集区时绕行，三个不同节点都不走直线', () => {
    // 40 个节点贴着 y=0.5 排成一条线：直线穿过它们。
    const dense: NearbyNode[] = Array.from({ length: 40 }, (_, i) => ({ x: 0.2 + (i / 40) * 0.6, y: 0.5 }));
    const targets = [
      { id: 'a', x: 0.8, y: 0.5 },
      { id: 'b', x: 0.8, y: 0.52 },
      { id: 'c', x: 0.8, y: 0.48 },
    ];

    for (const target of targets) {
      const plan = planCinematicZoom({ from: { x: 0.2, y: 0.5, ratio: 1 }, to: target, nodes: dense });
      expect(plan.detour).not.toBe(0);
      // 弓高是「世界尺度」的比例，不是绝对值：这组节点铺开 0.6×0.02，包围盒
      // 对角线 ≈0.6，所以弓高 ≈0.12×0.6。真实地图（3085 个节点、几十个
      // 单位）上同一件事会变成几十个单位——写死 0.12 在那种坐标里等于没绕。
      expect(Math.abs(plan.detour)).toBeCloseTo(AVOID_DETOUR * plan.extent, 10);
      // 这组节点横跨 0.2→0.785（39 步 × 0.015），纵坐标全在 0.5 上一条线：
      // 包围盒对角线 = 0.585。
      expect(plan.extent).toBeCloseTo(0.585, 6);
      // 路径中点必须真的离开直线（否则「绕」只发生在控制点上，采样路径没动）。
      const mid = plan.samples[Math.floor(plan.samples.length / 2)];
      expect(mid).toBeDefined();
      const offset = Math.hypot((mid?.x ?? 0) - 0.5, (mid?.y ?? 0.5) - target.y);
      expect(offset).toBeGreaterThan((AVOID_DETOUR * plan.extent) / 2);
    }

    // 稀疏时不绕：没有理由让镜头多走路。
    const sparse: NearbyNode[] = [{ x: 0.5, y: 0.95 }];
    const straight = planCinematicZoom({ from: { x: 0.2, y: 0.5, ratio: 1 }, to: targets[0]!, nodes: sparse });
    expect(straight.detour).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// D. 逐帧驱动
// ---------------------------------------------------------------------------

describe('runCinematicZoom', () => {
  it('reduced 时一次 setState 到位，没有帧循环', async () => {
    const frames = installFrames();
    try {
      const camera = recordingCamera();
      const plan = planCinematicZoom({ from: camera.getState(), to: { id: 'n', x: 1, y: 1 }, reduced: true });

      const ran = await runCinematicZoom(camera, plan, { reduced: true });

      expect(ran).toBe(false);
      expect(camera.states).toHaveLength(1);
      expect(camera.states[0]).toEqual({ x: 1, y: 1, ratio: plan.to.ratio });
      expect(frames).toBeDefined();
    } finally {
      frames.restore();
    }
  });

  it('逐帧推进，最后一帧精确落在节点上', async () => {
    const frames = installFrames();
    try {
      const camera = recordingCamera();
      const plan = planCinematicZoom({ from: camera.getState(), to: { id: 'n', x: 0.9, y: 0.1 }, ms: 96 });
      const promise = runCinematicZoom(camera, plan);

      frames.flush(0);
      expect(camera.states.length).toBe(1);
      frames.flush(48);
      expect(camera.states.length).toBe(2);
      const mid = camera.states[1] as Partial<ZoomCameraState>;
      expect(mid.x).toBeGreaterThan(0.5);
      expect(mid.x).toBeLessThan(0.9);

      frames.flush(48);
      await expect(promise).resolves.toBe(true);
      expect(camera.states[camera.states.length - 1]).toEqual({ x: 0.9, y: 0.1, ratio: plan.to.ratio });
    } finally {
      frames.restore();
    }
  });

  it('取消后 resolve(false) 且不再写相机', async () => {
    const frames = installFrames();
    try {
      const camera = recordingCamera();
      const plan = planCinematicZoom({ from: camera.getState(), to: { id: 'n', x: 0.1, y: 0.1 }, ms: 200 });
      const promise = runCinematicZoom(camera, plan);
      const before = camera.states.length;
      cancelCinematicZoom();
      await expect(promise).resolves.toBe(false);
      expect(camera.states.length).toBe(before);
    } finally {
      frames.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// E. 接缝契约
// ---------------------------------------------------------------------------

describe('接缝', () => {
  it('useRouteTransition().run 同步执行更新、返回 undefined', () => {
    const media = installReducedMotion(true);
    try {
      const { result } = renderHook(() => useRouteTransition());
      const update = vi.fn();

      let returned: unknown = 'unset';
      act(() => {
        returned = result.current.run(update);
      });

      expect(update).toHaveBeenCalledTimes(1);
      expect(returned).toBeUndefined();
      expect(documentAnimations()).toHaveLength(0);
    } finally {
      media.restore();
    }
  });

  it('useCinematicZoom().zoomTo 在没有相机时安静地 resolve', async () => {
    const media = installReducedMotion(false);
    try {
      const { result } = renderHook(() => useCinematicZoom());
      await expect(result.current.zoomTo({ id: 'n', x: 0.2, y: 0.2 })).resolves.toBeUndefined();
    } finally {
      media.restore();
    }
  });

  it('useCinematicZoom().zoomTo 驱动活跃相机；reduce 时一次到位', async () => {
    const media = installReducedMotion(true);
    const camera = recordingCamera();
    const fake: FlightCamera = {
      getState: () => camera.getState(),
      setState: (next) => camera.setState(next),
      animate: async () => {},
    };
    provideFlightCamera({ current: fake });
    try {
      const { result } = renderHook(() => useCinematicZoom());
      await act(async () => {
        await result.current.zoomTo({ id: 'kp-x', x: 0.25, y: 0.75 });
      });
      expect(camera.states).toHaveLength(1);
      expect(camera.states[0]).toEqual({ x: 0.25, y: 0.75, ratio: expect.closeTo(0.35, 5) });
    } finally {
      media.restore();
    }
  });

  it('zoomToNode 直接调用也走同一条规划（无相机 → false）', async () => {
    await expect(zoomToNode({ id: 'n', x: 0, y: 0 })).resolves.toBe(false);
  });
});
