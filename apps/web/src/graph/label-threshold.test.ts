/**
 * 标签阈值的单测。
 *
 * 票 03 第 6 条：「缩放低于阈值时只画点不画标签」。这条最容易做成「看起来
 * 有，缩一下却不生效」—— 所以判据本身要能被单测钉住，渲染层只负责把
 * `shouldShowLabels` 的结果翻译成 reducer 的 `labelVisibility`。
 */
import { describe, expect, it } from 'vitest';
import { LABEL_HIDE_RATIO, shouldShowLabels, shouldShowNodeLabel } from './label-threshold.js';

describe('shouldShowLabels', () => {
  it('默认视野（ratio=1）显示标签', () => {
    expect(shouldShowLabels(1)).toBe(true);
  });

  it('缩小一格（ratio=1.7）后不显示 —— 门槛故意设得激进', () => {
    // 缩到看全图时，留下的标签会糊成一片；节点形状本身始终在
    expect(shouldShowLabels(1.7)).toBe(false);
  });

  it('放大（ratio<1）当然显示', () => {
    expect(shouldShowLabels(0.5)).toBe(true);
    expect(shouldShowLabels(0.1)).toBe(true);
  });

  it('阈值边界：恰好等于阈值就隐藏', () => {
    expect(shouldShowLabels(LABEL_HIDE_RATIO)).toBe(false);
    expect(shouldShowLabels(LABEL_HIDE_RATIO - 0.001)).toBe(true);
  });

  it('非法 ratio 时宁多画标签，不让图看起来是空的', () => {
    expect(shouldShowLabels(Number.NaN)).toBe(true);
    expect(shouldShowLabels(Number.POSITIVE_INFINITY)).toBe(true);
  });
});

describe('shouldShowNodeLabel', () => {
  it('焦点节点在缩小后仍然带标签 —— 它是方位参照点', () => {
    expect(shouldShowNodeLabel(5, true)).toBe(true);
  });

  it('普通节点跟随缩放', () => {
    expect(shouldShowNodeLabel(1, false)).toBe(true);
    expect(shouldShowNodeLabel(3, false)).toBe(false);
  });
});
