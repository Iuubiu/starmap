/**
 * 悬停名牌落点的边界（票 86）。
 *
 * 这些断言能在 jsdom 里跑，正是因为 `hover-label.ts` 不碰 DOM：画布尺寸与
 * 指针坐标都是入参。真浏览器里的渲染（名牌真的出现在节点旁）由 Playwright
 * 探针取证，两层各管一段，互不冒充。
 */
import { describe, expect, it } from 'vitest';
import { estimateHoverLabelWidth, placeHoverLabel } from './hover-label.js';

const CANVAS = { width: 500, height: 400 };

describe('placeHoverLabel', () => {
  it('默认收在指针上方，横向以指针为中心', () => {
    expect(placeHoverLabel({ x: 250, y: 200 }, CANVAS)).toEqual({
      left: 250,
      top: 200 - 14 - 26,
      below: false,
    });
  });

  it('指针贴近顶边时翻到下方', () => {
    const placement = placeHoverLabel({ x: 250, y: 20 }, CANVAS);
    expect(placement.below).toBe(true);
    expect(placement.top).toBe(20 + 14);
  });

  it('贴左边时连名牌半宽一起留在画布内', () => {
    const labelWidth = estimateHoverLabelWidth('半导体探测器');
    expect(labelWidth).toBe(26 + 6 * 13);
    expect(placeHoverLabel({ x: 0, y: 200 }, CANVAS, { labelWidth }).left).toBe(10 + labelWidth / 2);
  });

  it('贴右边时连名牌半宽一起留在画布内', () => {
    const labelWidth = estimateHoverLabelWidth('半导体探测器');
    expect(placeHoverLabel({ x: 500, y: 200 }, CANVAS, { labelWidth }).left).toBe(
      500 - 10 - labelWidth / 2,
    );
  });

  it('画布窄到放不下整块名牌时，退化为只夹中心点', () => {
    const narrow = { width: 60, height: 400 };
    // minLeft=110 > maxLeft=-50，整块放不下；中心点仍夹在 [10, width-10]。
    expect(placeHoverLabel({ x: 30, y: 200 }, narrow, { labelWidth: 200 }).left).toBe(30);
    expect(placeHoverLabel({ x: 0, y: 200 }, narrow, { labelWidth: 200 }).left).toBe(10);
  });

  it('下方也放不下时把顶边夹回画布内', () => {
    expect(placeHoverLabel({ x: 250, y: 36 }, { width: 500, height: 60 }).top).toBe(
      60 - 26 - 10,
    );
  });

  it('坐标是 NaN 时不产出 NaN 落点', () => {
    const placement = placeHoverLabel({ x: Number.NaN, y: Number.NaN }, CANVAS);
    expect(Number.isNaN(placement.left)).toBe(false);
    expect(Number.isNaN(placement.top)).toBe(false);
    expect(placement.left).toBe(10);
    expect(placement.top).toBe(10);
  });
});

describe('estimateHoverLabelWidth', () => {
  it('短名字有下限，长名字封顶到 CSS 的 max-width', () => {
    expect(estimateHoverLabelWidth('图')).toBe(48);
    expect(estimateHoverLabelWidth('半导体探测器')).toBe(104);
    expect(estimateHoverLabelWidth('电荷灵敏前置放大器与脉冲成形网络的噪声分析')).toBe(260);
  });
});
