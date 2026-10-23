/**
 * 连续缩放镜头（票 t60）：从地图全局一路缩进到某个知识点的近景。
 *
 * ## 为什么不是「淡出淡入」
 *
 * 阶段推进时学习者要回答一个问题：「我现在在整张图的哪里？」淡入淡出把前后
 * 两屏之间的公共锚点全部抹掉——旧屏整体消失、新屏整体出现，眼睛只能重新
 * 建立方位。连续缩放则相反：**同一个东西一直在屏幕上**，只是从远到近。人对
 * 「连续位移」有免费的感知（追踪运动），对「两帧无关画面」没有。
 *
 * ## 三段式：规划、驱动、落点
 *
 * - `planCinematicZoom()` 是**纯函数**：给定起点相机、目标节点、周边节点位置，
 *   算出「走哪条弧、花多少毫秒、沿途的采样点」。它不碰 DOM、不碰 rAF，因此
 *   可以在单测里穷举——包括「这条路径会不会横穿节点密集区」这种只有算过才
 *   知道的事。
 * - `runCinematicZoom()` 只负责把算好的路线逐帧写进相机。
 * - `zoomToNode()` / `useCinematicZoom()` 是产品入口：前者从
 *   `camera-flight` 的活跃相机出发（`/map` 之外没有相机时返回 `false`），
 *   后者在 React 里拿到 reduce 偏好并自动带上。
 *
 * ## reduce 下是「没有帧循环」，不是「时长为 0 的动画」
 *
 * `runCinematicZoom()` 在 reduced 时直接 `setState()` 一次然后 resolve：不
 * 申请 rAF、不产生中间态。这与 `camera-flight.ts`、`EnterOnMount.tsx` 同一
 * 条口径——降级要能从调用栈上证明，而不是靠「动画时长是 0」这种仍然要跑
 * 一遍循环、只是没人看见的写法（那种写法在低端机上照样掉帧）。
 *
 * ## 为什么路径要绕开节点密集区
 *
 * 镜头**穿堂而过**一块密集区时，中间几帧会同时出现几十个节点涌向屏幕边缘，
 * 在 1280×800 的核显上就是一次掉帧 + 一次视觉噪音。直线不可行时沿垂直方向
 * 弓一下：位移几乎不变（弓高相对于直线距离很小），但沿途的节点数少一个量级。
 * 选哪一侧由「哪边节点少」决定，所以同一个起终点每次都是一样的路径——不做
 * 随机，避免测试与真机表现打架。
 */

import { FLY_IN_RATIO_FACTOR, activeFlightCamera } from './camera-flight';
import {
  REDUCED_MOTION_QUERY,
  cinematicDuration,
  clampCinematicMs,
  easeOutProgress,
} from './tokens';

/** 目标节点：`id` 只用于日志/测试断言，坐标是 sigma 的图坐标。 */
export interface ZoomTarget {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/** 相机状态（图坐标 + ratio）。与 `graph/camera.ts` 的 `CinematicCameraState` 同构。 */
export interface ZoomCameraState {
  readonly x: number;
  readonly y: number;
  readonly ratio: number;
}

/**
 * 本模块需要的最小相机面。
 *
 * 与 `camera-flight.ts` 的 `FlightCamera` 一样刻意**不 import** `graph/camera.js`：
 * `motion/` 不依赖渲染层，`CinematicCamera` 靠结构化类型天然满足它，单测用
 * 三行假对象就能冒充。
 */
export interface ZoomCameraSink {
  getState(): ZoomCameraState;
  setState(next: Partial<ZoomCameraState>): void;
}

/** 周边节点的位置（只要坐标）：避让密集区用。 */
export interface NearbyNode {
  readonly x: number;
  readonly y: number;
}

/** 路径上的一点。`t` 是**时间**进度（0–1），不是几何参数。 */
export interface ZoomSample extends ZoomCameraState {
  readonly t: number;
}

export interface CinematicZoomPlan {
  /** 目标节点 id（日志/断言用）。 */
  readonly id: string;
  /** 起点相机状态（＝规划那一刻的真实视野）。 */
  readonly from: ZoomCameraState;
  /** 终点相机状态（节点居中 + 近景 ratio）。 */
  readonly to: ZoomCameraState;
  /** 二次贝塞尔的控制点（图坐标）。直线时在两点中点。 */
  readonly control: { readonly x: number; readonly y: number };
  /** 弓高（图坐标）。0 表示直线。 */
  readonly detour: number;
  /** 起终点直线距离（图坐标）。 */
  readonly distance: number;
  /**
   * 这段镜头用的「世界尺度」（图坐标下的一个视口宽）。
   *
   * 图坐标**不是**归一化的 0–1：它是力导向布局吐出来的原始坐标，量纲随
   * 节点数、斥力参数浮动（实测本仓 3085 个节点铺开约 20 个单位）。所以
   * 「0.035 的走廊」这种话说出来必须带单位——这里的 `extent` 就是单位：
   * 走廊与弓高都是 `extent` 的比例，时长也按 `distance / extent` 查表。
   */
  readonly extent: number;
  /** 时长（毫秒）。reduced 时为 0。 */
  readonly ms: number;
  /** 沿途采样（含 t=0 与 t=1），顺序按时间。 */
  readonly samples: readonly ZoomSample[];
}

/** 轨迹采样数。12 段足够让「会不会穿过密集区」的判定稳定，又不至于贵。 */
export const PATH_SAMPLES = 12;

/** 避让判定的走廊半径（图坐标）。0.035 ≈ 屏幕上约 1/30 视口宽。 */
export const AVOID_CORRIDOR = 0.035;

/** 走廊内超过这么多个节点，就算「密集」，需要绕。 */
export const AVOID_TRIGGER = 6;

/** 绕行时的最大弓高（图坐标）。再大就会让人觉得「镜头绕路了」。 */
export const AVOID_DETOUR = 0.12;

/** 近景 ratio 的下限：再近就只剩一个孤点，空间感反而消失。 */
export const MIN_RATIO = 0.02;

function finite(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

function clampRatio(ratio: number): number {
  const safe = finite(ratio, 1);
  if (safe <= MIN_RATIO) return MIN_RATIO;
  return safe > 1 ? 1 : safe;
}

function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * 世界尺度：显式给了就用；否则用 `nodes` 的包围盒对角线；都没有就退化成 1。
 *
 * 从 `nodes` 推是产品路径的默认值——调用方只手里有「图里有哪些节点」，
 * 不该再被要求算一遍尺度。对角线而不是边长，是因为图通常不是正方形，
 * 对角线更接近「一屏装得下的长度」。
 */
function extentOf(explicit: number | undefined, nodes: readonly NearbyNode[]): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) return explicit;
  if (nodes.length < 2) return 1;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
    if (node.x < minX) minX = node.x;
    if (node.x > maxX) maxX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.y > maxY) maxY = node.y;
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY);
  return Number.isFinite(diagonal) && diagonal > 0 ? diagonal : 1;
}

/**
 * 二次贝塞尔在几何参数 `s` 处的点。
 *
 * 与时间进度分开：镜头走的是**几何弧**，而时间是匀速推进的（配 easeOut 的
 * 收尾）。两者混在一起会让镜头在弧的拐弯处突然加速。
 */
function bezierAt(
  from: { x: number; y: number },
  control: { x: number; y: number },
  to: { x: number; y: number },
  s: number,
): { x: number; y: number } {
  const u = 1 - s;
  return {
    x: u * u * from.x + 2 * u * s * control.x + s * s * to.x,
    y: u * u * from.y + 2 * u * s * control.y + s * s * to.y,
  };
}

/**
 * 统计走廊内的节点数（不含起终点附近的——那些本来就在画面里）。
 *
 * 用「到折线各段的最小距离」，而不是「到直线的距离」：绕行路径是弧，
 * 用直线量会把绕出去那部分也算成擦边。
 */
function corridorCount(
  points: readonly { x: number; y: number }[],
  nodes: readonly NearbyNode[],
  radius: number,
): number {
  let count = 0;
  for (const node of nodes) {
    for (let i = 0; i + 1 < points.length; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      if (a === undefined || b === undefined) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      // 线段退化成点时按点距算。
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((node.x - a.x) * dx + (node.y - a.y) * dy) / len2));
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      if (Math.hypot(node.x - px, node.y - py) <= radius) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

/** 沿弧采样（只算几何，不算时间）。 */
function arcPoints(
  from: { x: number; y: number },
  control: { x: number; y: number },
  to: { x: number; y: number },
  steps: number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i += 1) points.push(bezierAt(from, control, to, i / steps));
  return points;
}

/** ratio 用几何插值：视觉上「缩放速度恒定」，线性插值会让最后一段猛冲。 */
function interpolateRatio(from: number, to: number, p: number): number {
  if (from > 0 && to > 0) return from * (to / from) ** p;
  return from + (to - from) * p;
}

export interface PlanCinematicZoomInput {
  /** 规划那一刻的相机状态（全局视野通常是 `{x: 中心, y: 中心, ratio: 1}`）。 */
  readonly from: ZoomCameraState;
  /** 目标节点。 */
  readonly to: ZoomTarget;
  /** 周边节点位置（图坐标）。省略 = 不做避让（例如测试里只关心时长）。 */
  readonly nodes?: readonly NearbyNode[];
  /** reduce 偏好：为真时 `ms` 为 0、`samples` 只有落点。 */
  readonly reduced?: boolean;
  /** 指定时长；省略时由距离决定（`cinematicDuration`）。 */
  readonly ms?: number;
  /**
   * 「世界尺度」：图坐标下的一个视口宽。省略时从 `nodes` 的包围盒对角线推。
   *
   * 产品代码不用传：给了 `nodes` 就够。单测传单位空间里的小坐标时，推出来的
   * 尺度同样小，走廊按比例缩，判定依然成立。
   */
  readonly extent?: number;
  /** 目标 ratio；省略时按 `FLY_IN_RATIO_FACTOR` 从当前 ratio 推出近景。 */
  readonly ratio?: number;
}

/**
 * 规划一段连续缩放（纯函数）。
 *
 * 只做三件事：定落点、定路线、定时长。判定「要不要绕」的阈值全部导出成
 * 常量，单测可以贴着这些常量写边界值，而不是对着魔法数字写。
 */
export function planCinematicZoom(input: PlanCinematicZoomInput): CinematicZoomPlan {
  const from: ZoomCameraState = {
    x: finite(input.from.x, 0),
    y: finite(input.from.y, 0),
    ratio: clampRatio(input.from.ratio),
  };
  const toPoint = { x: finite(input.to.x, from.x), y: finite(input.to.y, from.y) };
  const to: ZoomCameraState = {
    x: toPoint.x,
    y: toPoint.y,
    ratio: clampRatio(input.ratio ?? from.ratio * FLY_IN_RATIO_FACTOR),
  };

  const nodes = input.nodes ?? [];
  const extent = extentOf(input.extent, nodes);
  // 走廊与弓高都是「一个视口宽」的比例：图坐标没有统一量纲，绝对值会随
  // 节点数与斥力参数漂移，写死 0.035 在 3085 个节点的图上等于零。
  const corridor = AVOID_CORRIDOR * extent;
  const detourAmp = AVOID_DETOUR * extent;

  const distance = distanceBetween(from, to);
  const reduced = input.reduced ?? false;
  const ms = reduced
    ? 0
    : input.ms === undefined
      ? cinematicDuration(distance / extent)
      : clampCinematicMs(input.ms);

  // 起点与终点重合时没有方向：弓形无意义，直接落点。
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  // 垂直单位向量：起点终点重合时没有方向，弓形也就没有意义。
  const nx = distance === 0 ? 0 : -(to.y - from.y) / distance;
  const ny = distance === 0 ? 0 : (to.x - from.x) / distance;

  let detour = 0;
  if (distance > 0 && nodes.length > 0) {
    const straightPoints = arcPoints(from, mid, to, PATH_SAMPLES);
    if (corridorCount(straightPoints, nodes, corridor) > AVOID_TRIGGER) {
      const offsets = [detourAmp, -detourAmp] as const;
      let best: number = offsets[0];
      let bestCount = Number.POSITIVE_INFINITY;
      for (const offset of offsets) {
        // 二次贝塞尔在 s=0.5 处只到控制点一半，控制点要放两倍才得到弓高 offset。
        const candidate = { x: mid.x + nx * offset * 2, y: mid.y + ny * offset * 2 };
        const count = corridorCount(arcPoints(from, candidate, to, PATH_SAMPLES), nodes, corridor);
        if (count < bestCount) {
          bestCount = count;
          best = offset;
        }
      }
      detour = best;
    }
  }

  const control = { x: mid.x + nx * detour * 2, y: mid.y + ny * detour * 2 };

  const samples: ZoomSample[] = [];
  if (reduced || ms <= 0) {
    samples.push({ t: 1, x: to.x, y: to.y, ratio: to.ratio });
  } else {
    for (let i = 0; i <= PATH_SAMPLES; i += 1) {
      const t = i / PATH_SAMPLES;
      const p = easeOutProgress(t);
      const point = bezierAt(from, control, to, p);
      samples.push({ t, x: point.x, y: point.y, ratio: interpolateRatio(from.ratio, to.ratio, p) });
    }
  }

  return { id: input.to.id, from, to, control, detour, distance, extent, ms, samples };
}

/** 某一时刻的相机状态（`ms` 已由 plan 决定）。 */
export function stateAt(plan: CinematicZoomPlan, elapsedMs: number): ZoomCameraState {
  if (plan.ms <= 0) return { x: plan.to.x, y: plan.to.y, ratio: plan.to.ratio };
  const t = Math.max(0, Math.min(1, elapsedMs / plan.ms));
  const p = easeOutProgress(t);
  const point = bezierAt(plan.from, plan.control, plan.to, p);
  return { x: point.x, y: point.y, ratio: interpolateRatio(plan.from.ratio, plan.to.ratio, p) };
}

/**
 * 这条路径的「沿途密度」：走廊半径 `AVOID_CORRIDOR` 内的节点数。
 *
 * 规划时用它决定要不要绕；测试用它证明「绕完真的更空」。导出而不是内部函数，
 * 是因为验收要的是**可复核的数字**（e2e 里拿真实布局的 3085 个节点算一遍），
 * 而不是「代码里写着会绕」。
 */
export function densityAlong(plan: CinematicZoomPlan, nodes: readonly NearbyNode[]): number {
  return corridorCount(
    plan.samples.map((sample) => ({ x: sample.x, y: sample.y })),
    nodes,
    AVOID_CORRIDOR * plan.extent,
  );
}

let pending: { cancel: () => void } | null = null;

/** 取消进行中的镜头（换目标/卸载时用；也是单测的清理点）。 */
export function cancelCinematicZoom(): void {
  if (pending !== null) {
    const { cancel } = pending;
    pending = null;
    cancel();
  }
}

/**
 * 按规划逐帧驱动相机。
 *
 * 返回是否真的跑了帧循环：reduced/`ms <= 0` 时返回 `false`（一次 `setState`
 * 到位），调用方据此区分「跳过去」与「飞过去」。
 *
 * 中途被 `cancelCinematicZoom()` 取消时 promise 仍然 resolve，但返回 `false`：
 * 取消是正常的控制流（换了目标节点），不该冒泡成异常。取消时**停在当前帧**，
 * 不把旧落点写上——下一次镜头从「现在这里」接着走，比先跳到旧目标再折返更
 * 连贯；卸载时相机已经没了，写不写都无所谓。
 */
export function runCinematicZoom(
  sink: ZoomCameraSink,
  plan: CinematicZoomPlan,
  options: { reduced?: boolean } = {},
): Promise<boolean> {
  if (options.reduced === true || plan.ms <= 0 || typeof requestAnimationFrame !== 'function') {
    sink.setState({ x: plan.to.x, y: plan.to.y, ratio: plan.to.ratio });
    return Promise.resolve(false);
  }

  cancelCinematicZoom();

  return new Promise<boolean>((resolve) => {
    const startedAt = performance.now();
    let frame = 0;
    let settled = false;

    const finish = (cancelled: boolean): void => {
      if (settled) return;
      settled = true;
      pending = null;
      resolve(!cancelled);
    };

    const tick = (): void => {
      const elapsed = performance.now() - startedAt;
      if (elapsed >= plan.ms) {
        sink.setState({ x: plan.to.x, y: plan.to.y, ratio: plan.to.ratio });
        finish(false);
        return;
      }
      const next = stateAt(plan, elapsed);
      sink.setState(next);
      frame = requestAnimationFrame(tick);
    };

    pending = {
      cancel: () => {
        if (frame !== 0) cancelAnimationFrame(frame);
        finish(true);
      },
    };
    frame = requestAnimationFrame(tick);
  });
}

/** 系统是否要求减少动效。SSR/jsdom 下 `matchMedia` 可能不存在。 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export interface ZoomToOptions {
  /** 指定时长（毫秒）；省略时按距离算。 */
  readonly ms?: number;
  /** 强制 reduce（测试与调用方显式降级用）；省略时读系统偏好。 */
  readonly reduced?: boolean;
  /** 周边节点位置（图坐标），用于绕开密集区。 */
  readonly nodes?: readonly NearbyNode[];
  /** 指定相机；省略时用 `camera-flight` 登记的活跃相机。 */
  readonly camera?: ZoomCameraSink | null;
}

/**
 * 非 hook 入口：把视野连续缩放到某个节点。
 *
 * 返回是否驱动了相机。没有相机（不在 `/map`）时返回 `false` 而不是抛错：
 * 「这里没有地图」是事实，不是异常——调用方据此决定要不要做别的转场。
 */
export async function zoomToNode(target: ZoomTarget, options: ZoomToOptions = {}): Promise<boolean> {
  const camera = options.camera === undefined ? activeFlightCamera() : options.camera;
  if (camera === null) return false;
  const reduced = options.reduced ?? prefersReducedMotion();
  const plan = planCinematicZoom({
    from: camera.getState(),
    to: target,
    ...(options.nodes === undefined ? {} : { nodes: options.nodes }),
    ...(options.ms === undefined ? {} : { ms: options.ms }),
    reduced,
  });
  return runCinematicZoom(camera, plan, { reduced });
}

/**
 * 接缝要求的 hook 面：`{ zoomTo }`。
 *
 * 签名来自 t60 票面：
 * `zoomTo: (target: { id: string; x: number; y: number }, opts?: { ms?: number }) => Promise<void>`。
 * 与 `zoomToNode()` 的差别只有两点：带上 React 侧的 reduce 偏好、把「有没有
 * 相机」这个布尔吞掉（hook 的调用方是事件处理器，它不关心返回值）。
 */
export function useCinematicZoom(): {
  zoomTo: (target: ZoomTarget, opts?: { ms?: number }) => Promise<void>;
} {
  return {
    zoomTo: async (target, opts) => {
      await zoomToNode(target, opts === undefined ? {} : { ms: opts.ms });
    },
  };
}
