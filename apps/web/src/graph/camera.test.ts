/**
 * 程序化相机的单测（票 62 验收第 5–7 条）。
 *
 * 这里测的是**契约**而不是动画：相机在 jsdom 里没有像素可动，但「部分状态
 * 合并成完整状态」「animate 的参数原样传下去」「Promise 透传」这三件事都是
 * 真实调用方（关卡浮层、回到焦点）会踩的语义，能在这里钉死。
 */
import { describe, expect, it } from 'vitest';
import {
  CinematicCamera,
  type CinematicCameraAdapter,
  type CinematicCameraOptions,
  type CinematicCameraState,
} from './camera.js';

interface RecordedAnimate {
  state: Partial<CinematicCameraState>;
  options: CinematicCameraOptions | undefined;
}

/**
 * 记录调用的假适配器：状态由测试手动持有，不涉及 sigma。
 */
function fakeAdapter(initial: CinematicCameraState) {
  const calls = {
    getState: 0,
    setState: [] as CinematicCameraState[],
    animate: [] as RecordedAnimate[],
  };
  let state = initial;
  const adapter: CinematicCameraAdapter = {
    getState: () => {
      calls.getState += 1;
      return state;
    },
    setState: (next) => {
      calls.setState.push(next);
      state = next;
    },
    animate: (next, options) => {
      calls.animate.push({ state: next, options });
      return Promise.resolve();
    },
  };
  return { adapter, calls, current: () => state };
}

describe('CinematicCamera', () => {
  it('getState 原样返回适配器的状态', () => {
    const { adapter } = fakeAdapter({ x: 0.25, y: 0.5, ratio: 1.5 });
    const camera = new CinematicCamera(adapter);

    expect(camera.getState()).toEqual({ x: 0.25, y: 0.5, ratio: 1.5 });
  });

  it('setState 只改传入的字段，未传的保持当前值', () => {
    const { adapter, calls } = fakeAdapter({ x: 0.25, y: 0.5, ratio: 1.5 });
    const camera = new CinematicCamera(adapter);

    camera.setState({ x: 0.75 });

    expect(calls.setState).toHaveLength(1);
    // 关键：ratio 与 y 不能被默认值悄悄重置 —— 只传 x 的调用方不该丢视野
    expect(calls.setState[0]).toEqual({ x: 0.75, y: 0.5, ratio: 1.5 });
  });

  it('setState 之后 getState 读到新值', () => {
    const { adapter } = fakeAdapter({ x: 0, y: 0, ratio: 1 });
    const camera = new CinematicCamera(adapter);

    camera.setState({ x: 0.1, y: 0.2, ratio: 4 });

    expect(camera.getState()).toEqual({ x: 0.1, y: 0.2, ratio: 4 });
  });

  it('animate 原样透传目标状态与选项', async () => {
    const { adapter, calls } = fakeAdapter({ x: 0, y: 0, ratio: 1 });
    const camera = new CinematicCamera(adapter);

    await camera.animate({ x: 0.8, y: 0.2 }, { duration: 350 });

    expect(calls.animate).toEqual([{ state: { x: 0.8, y: 0.2 }, options: { duration: 350 } }]);
  });

  it('不传选项时也不替调用方编一个默认时长', () => {
    const { adapter, calls } = fakeAdapter({ x: 0, y: 0, ratio: 1 });
    const camera = new CinematicCamera(adapter);

    void camera.animate({ ratio: 2 });

    expect(calls.animate[0]?.options).toBeUndefined();
  });

  it('animate 返回适配器的 Promise（浮层可以等动画结束再落脚）', async () => {
    const { adapter, calls } = fakeAdapter({ x: 0, y: 0, ratio: 1 });
    const camera = new CinematicCamera(adapter);

    const pending = camera.animate({ x: 1 });
    expect(calls.animate).toHaveLength(1);
    await expect(pending).resolves.toBeUndefined();
  });

  it('不修改调用方传进来的对象', () => {
    const { adapter } = fakeAdapter({ x: 0, y: 0, ratio: 1 });
    const camera = new CinematicCamera(adapter);
    const next = { x: 0.4 };

    camera.setState(next);

    expect(next).toEqual({ x: 0.4 });
  });

  it('每次 setState 都以 getState 为底，不缓存上一份快照', () => {
    const { adapter, calls } = fakeAdapter({ x: 0, y: 0, ratio: 1 });
    const camera = new CinematicCamera(adapter);

    camera.setState({ x: 1 });
    camera.setState({ y: 2 });

    // 第二次必须基于第一次之后的状态，而不是初始状态
    expect(calls.setState[1]).toEqual({ x: 1, y: 2, ratio: 1 });
  });
});
