import { describe, expect, it } from 'vitest';
import { computeWindow } from './virtualize.js';

/**
 * 窗口化的算术。
 *
 * 这些断言故意包含「不可能发生的入参」（负数、NaN、滚动到末尾之外）：
 * 它们来自浏览器，而浏览器给的 `scrollTop` / `clientHeight` 不是干净的整数。
 * 越界时应当退化成空窗口或夹紧，不是抛错 —— 列表为空是正常状态。
 */
const base = { rowHeight: 30, viewportHeight: 320, scrollTop: 0, overscan: 6 };

describe('computeWindow', () => {
  it('总数 0 返回空窗口', () => {
    expect(computeWindow({ ...base, total: 0 })).toEqual({
      start: 0,
      end: 0,
      offset: 0,
      totalHeight: 0,
    });
  });

  it('顶部时从第一行开始，渲染「视口行数 + 上下 overscan」', () => {
    const window = computeWindow({ ...base, total: 100 });
    expect(window.start).toBe(0);
    /* ceil(320/30)+1 = 12 行可见，上下各 6 行 overscan = 24 行 */
    expect(window.end).toBe(24);
    expect(window.totalHeight).toBe(3000);
    expect(window.offset).toBe(0);
  });

  it('滚动到中段时窗口跟着走，offset 与行高对齐', () => {
    const window = computeWindow({ ...base, total: 100, scrollTop: 300 });
    expect(window.start).toBe(4); /* 300/30 = 10，减去 6 行 overscan */
    expect(window.offset).toBe(window.start * 30);
    expect(window.end - window.start).toBe(24);
  });

  it('滚动超过末尾时夹紧，不返回越界下标', () => {
    const window = computeWindow({ ...base, total: 10, scrollTop: 99999 });
    expect(window.end).toBeLessThanOrEqual(10);
    expect(window.start).toBeLessThanOrEqual(window.end);
  });

  it('非有限数与负数被夹到安全值', () => {
    expect(computeWindow({ ...base, total: 10, scrollTop: Number.NaN }).start).toBe(0);
    expect(computeWindow({ ...base, total: 10, scrollTop: -50 }).start).toBe(0);
    expect(computeWindow({ ...base, total: 10, viewportHeight: Number.POSITIVE_INFINITY }).end).toBe(10);
  });

  it('行高非法时退化成空窗口（而不是除零得到 Infinity）', () => {
    expect(computeWindow({ ...base, total: 10, rowHeight: 0 }).end).toBe(0);
  });

  it('窗口大小与总条数无关 —— 这就是「DOM 行数不随总数增长」', () => {
    const at100 = computeWindow({ ...base, total: 100, scrollTop: 1500 });
    const at3000 = computeWindow({ ...base, total: 3000, scrollTop: 1500 });
    expect(at100.end - at100.start).toBe(at3000.end - at3000.start);
  });
});
