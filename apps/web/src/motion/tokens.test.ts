import { describe, expect, it } from 'vitest';
import {
  ENTER_OFFSET_PX,
  easeInOut,
  easeOut,
  easeOutProgress,
  instant,
  quick,
  resolveDuration,
  slow,
  standard,
} from './tokens';

/**
 * `resolveDuration` 是**唯一换算入口**，所以它的边界就是全站动效的边界。
 * 四组用例对应四种调用现场：正常播、reduced 关闭、调用方算出了 0、调用方
 * 算出了垃圾值。最后一组最容易被漏掉——它不来自用户，来自代码。
 */
describe('resolveDuration', () => {
  describe('第一组：正常播', () => {
    it('reduced 为 false 时原样返回', () => {
      expect(resolveDuration(quick, false)).toBe(quick);
      expect(resolveDuration(standard, false)).toBe(standard);
      expect(resolveDuration(slow, false)).toBe(slow);
      expect(resolveDuration(1234, false)).toBe(1234);
    });
  });

  describe('第二组：reduced 关闭', () => {
    it('reduced 为 true 时一律归 0', () => {
      expect(resolveDuration(quick, true)).toBe(0);
      expect(resolveDuration(standard, true)).toBe(0);
      expect(resolveDuration(slow, true)).toBe(0);
      expect(resolveDuration(60_000, true)).toBe(0);
    });

    it('reduced 优先于「非法值」判断，两者都得到 0', () => {
      expect(resolveDuration(Number.NaN, true)).toBe(0);
      expect(resolveDuration(-1, true)).toBe(0);
    });
  });

  describe('第三组：0', () => {
    it('0 在两种模式下都是 0', () => {
      expect(resolveDuration(0, false)).toBe(0);
      expect(resolveDuration(0, true)).toBe(0);
    });

    it('instant 就是 0，可以直接当参数用', () => {
      expect(instant).toBe(0);
      expect(resolveDuration(instant, false)).toBe(0);
    });
  });

  describe('第四组：非法值', () => {
    it('负数归 0 而不是取绝对值', () => {
      // 取绝对值会让「写错符号」这个 bug 变成一段看得见的动画；
      // 归 0 让它变成「什么都没发生」，测试里一眼能发现。
      expect(resolveDuration(-200, false)).toBe(0);
      expect(resolveDuration(-0.5, false)).toBe(0);
    });

    it('NaN 归 0', () => {
      expect(resolveDuration(Number.NaN, false)).toBe(0);
    });

    it('Infinity 归 0（无限时长会把动画挂死）', () => {
      expect(resolveDuration(Number.POSITIVE_INFINITY, false)).toBe(0);
      expect(resolveDuration(Number.NEGATIVE_INFINITY, false)).toBe(0);
    });
  });
});

describe('语义 token', () => {
  it('时长严格递增：instant < quick < standard < slow', () => {
    // 递增本身不是目的，目的是防止有人「为了让某处动画更快」把 quick 调成
    // 300ms——那会让所有用 quick 的地方一起变慢，而 token 的名字还在骗人。
    expect(instant).toBeLessThan(quick);
    expect(quick).toBeLessThan(standard);
    expect(standard).toBeLessThan(slow);
  });

  it('quick 是票面要求的 120ms 入场时长', () => {
    expect(quick).toBe(120);
  });

  it('入场位移是 8px', () => {
    expect(ENTER_OFFSET_PX).toBe(8);
  });

  it('缓动是合法的 CSS cubic-bezier', () => {
    const shape = /^cubic-bezier\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)$/;
    expect(easeOut).toMatch(shape);
    expect(easeInOut).toMatch(shape);
  });

  it('两条缓动不相同（入场与状态切换必须是两种手感）', () => {
    expect(easeOut).not.toBe(easeInOut);
  });
});

describe('easeOutProgress', () => {
  it('两端固定：0 → 0，1 → 1', () => {
    expect(easeOutProgress(0)).toBe(0);
    expect(easeOutProgress(1)).toBe(1);
  });

  it('单调递增', () => {
    let previous = -1;
    for (let i = 0; i <= 20; i += 1) {
      const value = easeOutProgress(i / 20);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('起步比线性快（这就是「减速」的含义）', () => {
    // easeOut 在 t=0.25 时应该已经走完一半以上，否则它就不是减速曲线。
    expect(easeOutProgress(0.25)).toBeGreaterThan(0.5);
    expect(easeOutProgress(0.5)).toBeGreaterThan(0.75);
  });

  it('越界与非法值被夹住', () => {
    expect(easeOutProgress(-1)).toBe(0);
    expect(easeOutProgress(2)).toBe(1);
    expect(easeOutProgress(Number.NaN)).toBe(0);
  });
});
