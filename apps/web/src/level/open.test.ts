import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeLevel,
  getOpenLevel,
  getServerSnapshot,
  openLevel,
  resetLevelOverlay,
  subscribeLevelOverlay,
} from './open';

/**
 * 门面的语义（票 68）。
 *
 * 这一层是纯状态 + 订阅，没有任何渲染，所以可以在 jsdom 里把每条规则钉死：
 * 幂等、替换不重播、三条关闭路径等价、退订后不再收到通知。浮层组件自己的
 * 行为（焦点陷阱、动画起止值、CLS）留给 `LevelOverlay.test.tsx` 与
 * `apps/web/e2e/overlay.spec.ts`。
 */
describe('关卡浮层门面', () => {
  beforeEach(() => {
    resetLevelOverlay();
  });

  describe('打开', () => {
    it('打开后能读到这一关', () => {
      openLevel('lv-a');
      expect(getOpenLevel()).toBe('lv-a');
    });

    it('重复打开同一关不通知订阅者（卡片连点两下、StrictMode 跑两遍）', () => {
      const listener = vi.fn();
      openLevel('lv-a');
      subscribeLevelOverlay(listener);

      openLevel('lv-a');
      openLevel('lv-a');

      expect(listener).not.toHaveBeenCalled();
      expect(getOpenLevel()).toBe('lv-a');
    });

    it('换一关是替换内容而不是先关再开（只通知一次，中间不经过 null）', () => {
      const seen: Array<string | null> = [];
      openLevel('lv-a');
      subscribeLevelOverlay(() => seen.push(getOpenLevel()));

      openLevel('lv-b');

      expect(seen).toEqual(['lv-b']);
      expect(getOpenLevel()).toBe('lv-b');
    });

    it('没开过时读到 null', () => {
      expect(getOpenLevel()).toBeNull();
    });
  });

  describe('关闭', () => {
    it('关闭后回到 null 并通知', () => {
      const listener = vi.fn();
      openLevel('lv-a');
      subscribeLevelOverlay(listener);

      closeLevel();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(getOpenLevel()).toBeNull();
    });

    it('已经关着时再关是空操作（Esc、点遮罩、面板内关闭可能同帧都触发）', () => {
      const listener = vi.fn();
      subscribeLevelOverlay(listener);

      closeLevel();
      closeLevel();

      expect(listener).not.toHaveBeenCalled();
    });

    it('关掉再打开同一关会重新通知（这是一次真的打开）', () => {
      const listener = vi.fn();
      openLevel('lv-a');
      closeLevel();
      subscribeLevelOverlay(listener);

      openLevel('lv-a');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(getOpenLevel()).toBe('lv-a');
    });
  });

  describe('订阅', () => {
    it('退订之后不再收到通知', () => {
      const listener = vi.fn();
      const unsubscribe = subscribeLevelOverlay(listener);
      unsubscribe();

      openLevel('lv-a');

      expect(listener).not.toHaveBeenCalled();
    });

    it('多个订阅者都能收到（宿主 + 可能的测试观察者）', () => {
      const first = vi.fn();
      const second = vi.fn();
      subscribeLevelOverlay(first);
      subscribeLevelOverlay(second);

      openLevel('lv-a');

      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('通知期间退订不会打乱其余订阅者', () => {
      const second = vi.fn();
      const unsubscribeFirst = subscribeLevelOverlay(() => {
        unsubscribeFirst();
      });
      subscribeLevelOverlay(second);

      expect(() => openLevel('lv-a')).not.toThrow();
      expect(second).toHaveBeenCalledTimes(1);
    });
  });

  describe('服务端快照', () => {
    it('恒为 null（浮层没有理由在首帧就声称开着）', () => {
      openLevel('lv-a');
      expect(getServerSnapshot()).toBeNull();
    });
  });
});
