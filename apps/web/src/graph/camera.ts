/**
 * 可脚本驱动的相机（票 62 验收第 5–7 条）。
 *
 * ## 为什么要有这一层
 *
 * 关卡浮层（t68）与「回到焦点节点」这类场景需要**程序化地移动地图视野**：
 * 不只是「跳到某处」，而是「用同一段缓动、同一个时长，从当前视野滑过去」。
 * 直接把 sigma 的 `Camera` 交给调用方会带出三个问题：
 *
 * 1. 它的 `setState()` 接受 `Partial<CameraState>`，但 `Partial` 里还有
 *    `angle`、`zoom` 之类我们并不打算开放的字段；
 * 2. 它挂在 sigma 实例上，而 sigma 会随节点子集变化被整体重建 —— 调用方
 *    手里那台相机会变成孤儿；
 * 3. 测试里没法只测「动画参数传对了没有」，必须起 WebGL。
 *
 * 所以这里定义一台**与渲染无关**的小相机：状态是三个数（x/y/ratio），
 * 由 `GraphCanvas` 用适配器接上真实的 sigma 相机。测试用一个记录调用的
 * 假适配器就能钉死全部语义。
 *
 * ## x / y 是图坐标，不是页面像素
 *
 * 这两个值来自 sigma/graphology 的节点属性——也就是
 * `graph.getNodeAttributes(id).x / .y`（力导向布局写回的位置），单位是图坐标。
 * 视口像素是另一套数：要拿它得经 `sigma.graphToViewport()`。把两者混起来
 * 的典型症状是「相机飞到了画布左上角外面」——因为像素值在几百量级，而图
 * 坐标在 0–1 附近。要「把视野对准某个节点」，正确写法是：
 *
 * ```ts
 * const { x, y } = graph.getNodeAttributes(microKpId);
 * camera.animate({ x, y });
 * ```
 *
 * ## 为什么不用全局注册表
 *
 * 相机是**每块画布一个**的运行时对象。放进模块级单例会在两个地图实例
 * （或地图页与关卡页同时存在）时互相覆盖，且无法在卸载时确定性清理。
 * `GraphCanvas` 通过 `cameraRef` prop 把实例交出去，卸载时置 `null`——
 * 生命周期由 React 的挂载/卸载决定，不留悬空引用。
 */

/** 相机状态。三个数就是 sigma 相机里我们真正会用的全部。 */
export interface CinematicCameraState {
  /** 图坐标 x（不是页面像素） */
  readonly x: number;
  /** 图坐标 y（不是页面像素） */
  readonly y: number;
  /** 缩放比：1 = 初始视野，越小越远 */
  readonly ratio: number;
}

/** `animate` 的选项。只开放时长：缓动曲线由画布统一决定。 */
export interface CinematicCameraOptions {
  readonly duration?: number;
}

/**
 * 真实相机的适配器。
 *
 * `GraphCanvas` 用 sigma 的 `Camera` 实现它；测试用记录器实现它。相机类
 * 本身不 import sigma，所以在 jsdom 里也能测。
 */
export interface CinematicCameraAdapter {
  getState(): CinematicCameraState;
  setState(state: CinematicCameraState): void;
  animate(state: Partial<CinematicCameraState>, options?: CinematicCameraOptions): Promise<void>;
}

/** 程序化相机。实例由 `GraphCanvas` 创建，通过 `cameraRef` 暴露。 */
export class CinematicCamera {
  private readonly adapter: CinematicCameraAdapter;

  constructor(adapter: CinematicCameraAdapter) {
    this.adapter = adapter;
  }

  /** 当前状态（图坐标 + ratio）。 */
  getState(): CinematicCameraState {
    return this.adapter.getState();
  }

  /**
   * 立即跳转。只传要改的字段，其余保持当前值。
   *
   * 与 `animate()` 的差别只有「有没有动画」：两者都接受部分状态，也都不
   * 允许调用方漏掉 ratio 之外的维度而被默认值悄悄重置。
   */
  setState(next: Partial<CinematicCameraState>): void {
    this.adapter.setState({ ...this.adapter.getState(), ...next });
  }

  /** 平滑移动到目标状态。返回的 Promise 在动画结束时兑现。 */
  animate(next: Partial<CinematicCameraState>, options?: CinematicCameraOptions): Promise<void> {
    return this.adapter.animate(next, options);
  }
}
