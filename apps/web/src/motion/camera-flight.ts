/**
 * 「镜头」的接线点（票 68）。
 *
 * ## 这一层解决什么问题
 *
 * 地图页的 sigma 相机是**每块画布一个**的运行时对象，由 `GraphCanvas` 通过
 * `cameraRef` prop 交出去（见 `apps/web/src/graph/camera.ts` 的说明）。而关卡
 * 浮层挂在 `App.tsx` 根上 —— 它和地图页不在同一棵子树里，拿不到那个 ref。
 *
 * 于是需要一条**单向**的通道：地图页把「当前活跃相机」这件事告诉别人，浮层
 * 在开合时问一句「现在有没有相机」。这条通道就是本文件。
 *
 * ## 为什么存的是 ref，不是相机实例
 *
 * 存实例就等于在模块里缓存一个会被卸载的对象，`GraphCanvas` 重建画布时
 * 老实例会变成孤儿（它的 `animate()` 静默不动，而调用方以为镜头在飞）。
 * 存 ref 则永远读「此刻」的那台相机：地图页卸载时 ref 由 `GraphCanvas` 置
 * `null`，读到的就是 `null`，浮层自然退化成「没有镜头可飞」而不是飞给幽灵。
 *
 * 也正因如此，这里的 `active` 在**任何时刻最多只有一个**：`/map` 是唯一挂载
 * `GraphCanvas` 的路由，同时开两块画布的情况在本产品里不存在。若将来出现
 * 多画布，正确的做法是让每个画布带 id、这里存一张 map，而不是让后注册的
 * 悄悄覆盖先注册的。
 *
 * ## reduce 下不发 rAF
 *
 * `flyIn` / `flyOut` 在 `reduced` 时走 `setState()`（瞬时跳转），**根本不调用
 * `animate()`** —— 与 `motion/EnterOnMount.tsx` 同一条口径：降级是结构性的
 * （没有调用就没有帧循环），不是靠「动画时长为 0」这种仍然要逐帧推进的写法。
 */

/** 相机状态（图坐标 + 缩放比）。与 `graph/camera.ts` 的 `CinematicCameraState` 结构一致。 */
export interface FlightCameraState {
  readonly x: number;
  readonly y: number;
  readonly ratio: number;
}

/**
 * 本模块需要的最小相机面。
 *
 * 刻意**不 import** `../graph/camera.js`：那会让 `motion/` 依赖 `graph/`，
 * 而 `graph/` 的布局参数与渲染细节跟动效无关。结构化类型让 `CinematicCamera`
 * 天然满足它，测试也能用三行假对象冒充。
 */
export interface FlightCamera {
  getState(): FlightCameraState;
  setState(next: Partial<FlightCameraState>): void;
  animate(next: Partial<FlightCameraState>, options?: { duration?: number }): Promise<void>;
}

/** 一个只读的 ref 壳子：地图页把自己的 `useRef` 交进来，卸载时传 `null` 注销。 */
export type FlightCameraRef = { current: FlightCamera | null };

let active: FlightCameraRef | null = null;

/**
 * 登记「当前活跃相机」。
 *
 * 地图页在挂载时调一次、卸载时传 `null`。传进来的必须是 ref 本身而不是
 * `ref.current` —— 相机是在 `GraphCanvas` 的 effect 里才被创建/销毁的，
 * 早于或晚于本函数的执行都可能，只有每次现读 ref 才不会读到过期值。
 */
export function provideFlightCamera(ref: FlightCameraRef | null): void {
  active = ref;
}

/** 此刻是否有相机可用。 */
export function activeFlightCamera(): FlightCamera | null {
  return active === null ? null : active.current;
}

/**
 * 浮层打开时的「推近」倍数。
 *
 * 0.35 是**观感值**，不是物理量：sigma 的 `ratio` 越小越近，1 是初始视野。
 * 取 0.35 意味着视野收窄到原来的三分之一左右 —— 足够让「地图退到后面」这件事
 * 被看见，又不会近到只剩一两个节点（那样关闭时「拉回」就没有参照物）。
 */
export const FLY_IN_RATIO_FACTOR = 0.35;

export interface FlightOptions {
  /** reduce 偏好：为真时瞬时跳转、不调用 `animate()`。 */
  readonly reduced: boolean;
  /** 动画时长（毫秒）。由调用方从 `motion/tokens.ts` 取，本模块不内置常量。 */
  readonly duration: number;
}

/**
 * 推近镜头（地图 → 关卡）。
 *
 * 返回是否真的驱动了相机 —— 没有相机时返回 `false`，调用方据此决定要不要
 * 做别的补偿（本票不做补偿：没有地图就没有镜头，这是事实而不是失败）。
 */
export async function flyIn(options: FlightOptions): Promise<boolean> {
  const camera = activeFlightCamera();
  if (camera === null) return false;

  const current = camera.getState();
  const next = { ratio: current.ratio * FLY_IN_RATIO_FACTOR };
  if (options.reduced || options.duration <= 0) {
    camera.setState(next);
    return true;
  }
  await camera.animate(next, { duration: options.duration });
  return true;
}

/**
 * 拉回镜头（关卡 → 地图）。
 *
 * 目标不是「上次打开前的 ratio」——那需要在打开时快照，而快照会跨组件、
 * 跨渲染存在，容易过期。这里直接回到**初始视野**（ratio = 1）：浮层关闭
 * 之后学习者要重新找位置，1 是「整张图」的语义，也是 `复位图谱视野` 按钮
 * 的同一个落点。
 */
export async function flyOut(options: FlightOptions): Promise<boolean> {
  const camera = activeFlightCamera();
  if (camera === null) return false;

  const next = { ratio: 1 };
  if (options.reduced || options.duration <= 0) {
    camera.setState(next);
    return true;
  }
  await camera.animate(next, { duration: options.duration });
  return true;
}

/** 清空（单测用）。 */
export function resetFlightCamera(): void {
  active = null;
}
