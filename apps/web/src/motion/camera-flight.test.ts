import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeFlightCamera,
  FLY_IN_RATIO_FACTOR,
  flyIn,
  flyOut,
  provideFlightCamera,
  resetFlightCamera,
  type FlightCamera,
} from './camera-flight';

/**
 * 镜头通道（票 68 验收第 8 条）。
 *
 * ## 这里为什么能证明「真驱动相机」
 *
 * 假相机记录 `setState` / `animate` 的调用。验收第 8 条要的是「不是 CSS 假缩放」，
 * 而 CSS 假缩放**根本不会调到这个接口** —— 所以只要断言调用真的发生、参数是
 * 图坐标与 ratio，就已经排除了那条路径。真实相机是不是真的动了，由
 * `apps/web/e2e/overlay.spec.ts` 在浏览器里读 sigma 的 `data-camera-ratio` 复核。
 *
 * ## reduce 的判据是「有没有调用 animate」
 *
 * 不是「动画时长是不是 0」：后者仍然要逐帧推进，只是每帧位移为 0。这里断言
 * `animate` 一次都没被调、`setState` 被调了一次 —— 那是结构性事实。
 */
function fakeCamera(state = { x: 0.5, y: 0.25, ratio: 1 }): FlightCamera & {
  setState: ReturnType<typeof vi.fn>;
  animate: ReturnType<typeof vi.fn>;
} {
  let current = { ...state };
  return {
    getState: () => current,
    setState: vi.fn((next: Partial<typeof current>) => {
      current = { ...current, ...next };
    }),
    animate: vi.fn(async (next: Partial<typeof current>) => {
      current = { ...current, ...next };
    }),
  } as unknown as FlightCamera & {
    setState: ReturnType<typeof vi.fn>;
    animate: ReturnType<typeof vi.fn>;
  };
}

describe('镜头通道', () => {
  beforeEach(() => {
    resetFlightCamera();
  });

  describe('登记', () => {
    it('没有登记时读不到相机', () => {
      expect(activeFlightCamera()).toBeNull();
    });

    it('登记后读得到，注销后读不到', () => {
      const camera = fakeCamera();
      provideFlightCamera({ current: camera });
      expect(activeFlightCamera()).toBe(camera);

      provideFlightCamera(null);
      expect(activeFlightCamera()).toBeNull();
    });

    it('存的是 ref 本身：ref.current 变化立刻可见，不是快照', () => {
      const first = fakeCamera();
      const second = fakeCamera();
      const ref: { current: FlightCamera | null } = { current: first };
      provideFlightCamera(ref);
      expect(activeFlightCamera()).toBe(first);

      // GraphCanvas 重建画布时会换实例（旧实例已被 kill）。
      ref.current = second;
      expect(activeFlightCamera()).toBe(second);
    });

    it('ref.current 被置 null（画布卸载）时读不到相机', () => {
      const ref: { current: FlightCamera | null } = { current: fakeCamera() };
      provideFlightCamera(ref);
      ref.current = null;
      expect(activeFlightCamera()).toBeNull();
    });
  });

  describe('推近（地图 → 关卡）', () => {
    it('把 ratio 乘以 FLY_IN_RATIO_FACTOR，x/y 不动', async () => {
      const camera = fakeCamera({ x: 0.3, y: 0.7, ratio: 1 });
      provideFlightCamera({ current: camera });

      const driven = await flyIn({ reduced: false, duration: 350 });

      expect(driven).toBe(true);
      expect(camera.animate).toHaveBeenCalledTimes(1);
      expect(camera.animate).toHaveBeenCalledWith(
        { ratio: 1 * FLY_IN_RATIO_FACTOR },
        { duration: 350 },
      );
      // 只改 ratio：把 x/y 一起写会顺带把视野挪走，那不是「推近」。
      expect(camera.animate.mock.calls[0]![0]).not.toHaveProperty('x');
      expect(camera.animate.mock.calls[0]![0]).not.toHaveProperty('y');
      expect(camera.getState()).toEqual({ x: 0.3, y: 0.7, ratio: FLY_IN_RATIO_FACTOR });
    });

    it('从已经推近的状态再推，是在当前 ratio 上乘（不是回到固定值）', async () => {
      const camera = fakeCamera({ x: 0, y: 0, ratio: 0.5 });
      provideFlightCamera({ current: camera });

      await flyIn({ reduced: false, duration: 200 });
      expect(camera.animate).toHaveBeenCalledWith(
        { ratio: 0.5 * FLY_IN_RATIO_FACTOR },
        { duration: 200 },
      );
    });

    it('没有相机时返回 false，不抛异常', async () => {
      await expect(flyIn({ reduced: false, duration: 350 })).resolves.toBe(false);
    });
  });

  describe('拉回（关卡 → 地图）', () => {
    it('回到初始视野 ratio = 1', async () => {
      const camera = fakeCamera({ x: 0.2, y: 0.4, ratio: FLY_IN_RATIO_FACTOR });
      provideFlightCamera({ current: camera });

      const driven = await flyOut({ reduced: false, duration: 350 });

      expect(driven).toBe(true);
      expect(camera.animate).toHaveBeenCalledWith({ ratio: 1 }, { duration: 350 });
      expect(camera.getState().ratio).toBe(1);
    });

    it('没有相机时返回 false', async () => {
      await expect(flyOut({ reduced: false, duration: 350 })).resolves.toBe(false);
    });
  });

  describe('reduce：瞬时跳转，不发 rAF', () => {
    it('flyIn 在 reduce 下只 setState，不调 animate', async () => {
      const camera = fakeCamera({ x: 0.1, y: 0.9, ratio: 1 });
      provideFlightCamera({ current: camera });

      const driven = await flyIn({ reduced: true, duration: 350 });

      expect(driven).toBe(true);
      expect(camera.animate).not.toHaveBeenCalled();
      expect(camera.setState).toHaveBeenCalledWith({ ratio: FLY_IN_RATIO_FACTOR });
      expect(camera.getState().ratio).toBe(FLY_IN_RATIO_FACTOR);
    });

    it('flyOut 在 reduce 下只 setState，不调 animate', async () => {
      const camera = fakeCamera({ x: 0, y: 0, ratio: FLY_IN_RATIO_FACTOR });
      provideFlightCamera({ current: camera });

      await flyOut({ reduced: true, duration: 350 });

      expect(camera.animate).not.toHaveBeenCalled();
      expect(camera.setState).toHaveBeenCalledWith({ ratio: 1 });
    });

    it('时长为 0 等价于 reduce（浮层可能只算出 0）', async () => {
      const camera = fakeCamera({ x: 0, y: 0, ratio: 1 });
      provideFlightCamera({ current: camera });

      await flyIn({ reduced: false, duration: 0 });

      expect(camera.animate).not.toHaveBeenCalled();
      expect(camera.setState).toHaveBeenCalledTimes(1);
    });

    it('reduce 下没有相机也不报错', async () => {
      await expect(flyIn({ reduced: true, duration: 350 })).resolves.toBe(false);
      await expect(flyOut({ reduced: true, duration: 350 })).resolves.toBe(false);
    });
  });
});
