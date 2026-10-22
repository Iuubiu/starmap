/**
 * 画布取色的单测（票 62 验收第 1、3、4 条）。
 *
 * 两件事在这里被钉死：
 *
 * 1. **颜色只能来自 token**：`graphColors()` 的每个字段都断言等于
 *    `palettes[theme]` 里的某个值，改 token 时这里不会撒谎；
 * 2. **对比度**：按 WCAG 相对亮度公式逐对复算，正文 4.5:1、图形 3:1。
 *    这些数字在 `palette.ts` 的 docblock 里列了一张表；表与测试只要有一边
 *    改动，另一边就会红 —— 这正是不把数字只写进注释的原因。
 */
import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GRAPH_NODE_TOKEN,
  GRAPH_THEME_ATTRIBUTE,
  graphColors,
  graphColorsFor,
  readThemeName,
  useGraphColors,
  useThemeName,
} from './palette.js';
import { STATUS_ORDER } from './status.js';
import { darkPalette, lightPalette, palettes, type ThemeName } from '../theme/tokens.js';

/** WCAG 相对亮度。输入是 `#RRGGBB`（palette 里的格式）。 */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 两色的 WCAG 对比度，恒 ≥1。 */
function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

const THEMES: readonly ThemeName[] = ['dark', 'light'];

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute(GRAPH_THEME_ATTRIBUTE);
});

describe('graphColors 只从 token 取色', () => {
  it.each(THEMES)('%s 主题的每个字段都等于对应 token 值', (theme) => {
    const palette = palettes[theme];
    const colors = graphColorsFor(theme);

    expect(colors.canvas).toBe(palette['graph-canvas']);
    expect(colors.grid).toBe(palette['graph-canvas-grid']);
    expect(colors.edge).toBe(palette['graph-edge']);
    expect(colors.label).toBe(palette['graph-label']);
    expect(colors.labelMuted).toBe(palette['graph-label-muted']);
    expect(colors.backdrop).toBe(palette['graph-node-backdrop']);
    expect(colors.focusRing).toBe(palette['graph-focus-ring']);
    for (const status of STATUS_ORDER) {
      expect(colors.nodes[status]).toBe(palette[GRAPH_NODE_TOKEN[status]]);
    }
  });

  it('两套主题都给全了四类节点色（键集不随主题变化）', () => {
    const dark = Object.keys(graphColors(darkPalette).nodes).sort();
    const light = Object.keys(graphColors(lightPalette).nodes).sort();

    expect(dark).toEqual([...STATUS_ORDER].sort());
    expect(light).toEqual(dark);
  });

  it('两套主题下四类节点色互不相同（颜色不是唯一通道，但也不能同色）', () => {
    for (const theme of THEMES) {
      const colors = graphColorsFor(theme);
      const values = STATUS_ORDER.map((status) => colors.nodes[status]);
      expect(new Set(values).size, `${theme} 主题的节点色有重复`).toBe(4);
    }
  });

  it('画布在两套主题里都是深色面板（不是亮底反相）', () => {
    for (const theme of THEMES) {
      const { canvas } = graphColorsFor(theme);
      // 相对亮度 < 0.05 ≈ 深色。旧亮主题那档浅灰画布（0.83）差得很远。
      expect(luminance(canvas), `${theme} 主题的画布不是深色`).toBeLessThan(0.05);
    }
  });
});

describe('画布对比度（WCAG AA）', () => {
  it.each(THEMES)('%s 主题的标签正文对画布 ≥ 4.5:1', (theme) => {
    const { canvas, label } = graphColorsFor(theme);
    expect(contrast(label, canvas)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('%s 主题的弱标签对画布 ≥ 4.5:1', (theme) => {
    const { canvas, labelMuted } = graphColorsFor(theme);
    expect(contrast(labelMuted, canvas)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('%s 主题的连线对画布 ≥ 3:1', (theme) => {
    const { canvas, edge } = graphColorsFor(theme);
    expect(contrast(edge, canvas)).toBeGreaterThanOrEqual(3);
  });

  it.each(THEMES)('%s 主题的四类节点对画布 ≥ 3:1', (theme) => {
    const { canvas, nodes } = graphColorsFor(theme);
    for (const status of STATUS_ORDER) {
      expect(contrast(nodes[status], canvas), `${theme}/${status}`).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(THEMES)('%s 主题的焦点环对画布 ≥ 3:1', (theme) => {
    const { canvas, focusRing } = graphColorsFor(theme);
    expect(contrast(focusRing, canvas)).toBeGreaterThanOrEqual(3);
  });

  it('焦点底衬比画布略亮一档（是「一层板」而不是另一块同色）', () => {
    for (const theme of THEMES) {
      const { canvas, backdrop } = graphColorsFor(theme);
      expect(luminance(backdrop), `${theme} 主题的底衬不可见`).toBeGreaterThan(luminance(canvas));
    }
  });

  it('网格刻意低于 3:1：它是装饰背景，不提亮到与节点抢注意力', () => {
    for (const theme of THEMES) {
      const { canvas, grid } = graphColorsFor(theme);
      expect(contrast(grid, canvas)).toBeLessThan(3);
      // 但也不能等于画布，否则网格完全不存在
      expect(grid).not.toBe(canvas);
    }
  });
});

describe('readThemeName', () => {
  it('属性缺失时回退 dark（与 tokens.css 的 :root 默认块一致）', () => {
    const root = document.createElement('html');
    expect(readThemeName(root)).toBe('dark');
  });

  it("读到 light / dark 两个合法值", () => {
    const root = document.createElement('html');
    root.setAttribute(GRAPH_THEME_ATTRIBUTE, 'light');
    expect(readThemeName(root)).toBe('light');
    root.setAttribute(GRAPH_THEME_ATTRIBUTE, 'dark');
    expect(readThemeName(root)).toBe('dark');
  });

  it('非法值回退 dark，而不是把它当 light 或抛错', () => {
    const root = document.createElement('html');
    root.setAttribute(GRAPH_THEME_ATTRIBUTE, 'high-contrast');
    expect(readThemeName(root)).toBe('dark');
  });

  it('root 为 null（SSR / 无 document）时回退 dark', () => {
    expect(readThemeName(null)).toBe('dark');
  });
});

/**
 * 钩子测试：换主题只改 `<html>` 属性、不刷新，画布颜色应自己跟上。
 *
 * 这里用最小探针组件，而不是渲染整张地图：要证明的是「属性变 → 颜色变」
 * 这条订阅，不是 sigma 能不能画点（那是 e2e 的事）。
 */
function Probe(): React.JSX.Element {
  const theme = useThemeName();
  const colors = useGraphColors();
  return createElement('div', {
    'data-testid': 'probe',
    'data-theme': theme,
    'data-canvas': colors.canvas,
    'data-label': colors.label,
  });
}

describe('useThemeName / useGraphColors', () => {
  it('挂载时读到当前属性，改属性后不重建组件就换色', async () => {
    const { getByTestId } = render(createElement(Probe));
    expect(getByTestId('probe').getAttribute('data-theme')).toBe('dark');
    expect(getByTestId('probe').getAttribute('data-canvas')).toBe(darkPalette['graph-canvas']);

    // MutationObserver 的回调在微任务里跑；act 会等它。
    await act(async () => {
      document.documentElement.setAttribute(GRAPH_THEME_ATTRIBUTE, 'light');
    });

    const probe = getByTestId('probe');
    expect(probe.getAttribute('data-theme')).toBe('light');
    expect(probe.getAttribute('data-canvas')).toBe(lightPalette['graph-canvas']);
    expect(probe.getAttribute('data-label')).toBe(lightPalette['graph-label']);
  });

  it('属性改回 dark 同样生效（两个方向都订阅）', async () => {
    document.documentElement.setAttribute(GRAPH_THEME_ATTRIBUTE, 'light');
    const { getByTestId } = render(createElement(Probe));
    expect(getByTestId('probe').getAttribute('data-theme')).toBe('light');

    await act(async () => {
      document.documentElement.setAttribute(GRAPH_THEME_ATTRIBUTE, 'dark');
    });

    expect(getByTestId('probe').getAttribute('data-theme')).toBe('dark');
  });

  it('不相关的属性变化不触发重渲', async () => {
    let renders = 0;
    function Counting(): React.JSX.Element {
      const theme = useThemeName();
      renders += 1;
      return createElement('span', { 'data-theme': theme });
    }

    render(createElement(Counting));
    const before = renders;

    await act(async () => {
      document.documentElement.setAttribute('data-sm-mode', 'light');
      await Promise.resolve();
    });

    expect(renders).toBe(before);
  });
});
