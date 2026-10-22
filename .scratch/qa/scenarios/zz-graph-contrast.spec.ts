import { test, expect } from '@playwright/test';

/**
 * t62 验收探针 B：知识地图的对比度数字（在浏览器里算，取的是真实解析值）。
 *
 * 和 `palette.test.ts` 的关系：单测在 Node 里直接读 `tokens.ts` 的字符串，
 * 这里读的是 `getComputedStyle(document.documentElement)` 上的 `--sm-*` ——
 * 也就是「token 有没有真的进到 CSS 变量层」这一段的端到端校验。两边算的
 * 都是 WCAG 相对亮度，结论必须一致。
 *
 * 阈值取 WCAG AA：正文 4.5:1、图形（节点/连线/焦点环）3:1。画布网格是装饰，
 * 刻意不设下限，只记录数字。
 */

const MEASURE = () => {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    theme: document.documentElement.getAttribute('data-sm-theme'),
    canvas: read('--sm-graph-canvas'),
    grid: read('--sm-graph-canvas-grid'),
    edge: read('--sm-graph-edge'),
    label: read('--sm-graph-label'),
    labelMuted: read('--sm-graph-label-muted'),
    backdrop: read('--sm-graph-node-backdrop'),
    focusRing: read('--sm-graph-focus-ring'),
    unseen: read('--sm-graph-node-unseen'),
    learning: read('--sm-graph-node-learning'),
    mastered: read('--sm-graph-node-mastered'),
    review: read('--sm-graph-node-review'),
    textPrimary: read('--sm-text-primary'),
    textSecondary: read('--sm-text-secondary'),
    bgSurface: read('--sm-bg-surface'),
  };
};

function luminance(hex: string): number {
  const value = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(value)) throw new Error(`不是 6 位 hex: ${hex}`);
  const channel = (start: number) => {
    const c = parseInt(value.slice(start, start + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const READ_TEXT_COLORS = () => {
  const pick = (selector: string, prop: 'color' | 'background-color') => {
    const el = document.querySelector(selector);
    return el ? getComputedStyle(el).getPropertyValue(prop) : '';
  };
  /** 图例的形状是内联 SVG 的子元素，`fill` 画在它身上，svg 本身只是容器。 */
  const glyphFill = (() => {
    const shape = document.querySelector('.graph-legend-item svg')?.firstElementChild;
    if (!shape) return '';
    const fill = getComputedStyle(shape).fill;
    return /^rgb/.test(fill) ? fill : shape.getAttribute('fill') ?? '';
  })();
  const style = getComputedStyle(document.documentElement);
  return {
    hintFg: pick('.graph-canvas-hint', 'color'),
    canvasBg: pick('.graph-canvas', 'background-color'),
    legendFg: pick('.graph-legend-item', 'color'),
    legendBg: pick('.graph-legend-item', 'background-color'),
    legendCountFg: pick('.graph-legend-count', 'color'),
    legendTotalFg: pick('.graph-legend-total', 'color'),
    legendGlyph: /^rgb/.test(glyphFill) ? glyphFill : '',
    rosterNameFg: pick('.graph-roster-name', 'color'),
    rosterStateFg: pick('.graph-roster-state', 'color'),
    rosterPercentFg: pick('.graph-roster-percent', 'color'),
    rosterBg: style.getPropertyValue('--sm-bg-surface').trim(),
  };
};

/** computed style 给的是 `rgb(r, g, b)` / `rgba(...)`，转成 `contrast()` 认的 hex。 */
function rgbToHex(value: string): string {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(value);
  if (!match) throw new Error(`不是 rgb() 颜色: ${value}`);
  const hex = match
    .slice(1, 4)
    .map((part) => Math.round(Number(part)).toString(16).padStart(2, '0'))
    .join('');
  return `#${hex}`;
}

test.describe.configure({ mode: 'serial' });

for (const theme of ['dark', 'light'] as const) {
  test(`${theme} 主题：标签/四态/连线/焦点环的对比度达到 AA`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript((mode) => localStorage.setItem('starmap.theme', mode), theme);
    await page.goto('/map');
    await expect(page.locator('.graph-canvas')).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(
        async () => Number(await page.locator('.graph-canvas').getAttribute('data-node-count')),
        { timeout: 60_000 },
      )
      .toBeGreaterThan(100);

    const value = await page.evaluate(MEASURE);
    expect(value.theme).toBe(theme);

    const pairs: Array<[string, string, string, number]> = [
      ['正文标签', value.label, value.canvas, 4.5],
      ['次要标签', value.labelMuted, value.canvas, 4.5],
      ['连线', value.edge, value.canvas, 3],
      ['未学节点', value.unseen, value.canvas, 3],
      ['在学节点', value.learning, value.canvas, 3],
      ['已掌握节点', value.mastered, value.canvas, 3],
      ['待复验节点', value.review, value.canvas, 3],
      ['焦点环', value.focusRing, value.canvas, 3],
      ['页面正文 vs 卡片', value.textPrimary, value.bgSurface, 4.5],
      ['页面次要文字 vs 卡片', value.textSecondary, value.bgSurface, 4.5],
    ];

    const table = pairs.map(([name, fg, bg, min]) => {
      const ratio = contrast(fg, bg);
      return { name, fg, bg, ratio: Number(ratio.toFixed(2)), min, ok: ratio >= min };
    });
    console.log(`\n[${theme}] 对比度实测`);
    console.table(table);
    console.log('额外记录（装饰，不设下限）:', {
      网格: Number(contrast(value.grid, value.canvas).toFixed(2)),
      焦点底衬: Number(contrast(value.backdrop, value.canvas).toFixed(2)),
    });

    for (const row of table) {
      expect(row.ok, `${theme} / ${row.name}: ${row.ratio}:1 < ${row.min}:1`).toBe(true);
    }

    /**
     * 第二组：读**真实渲染元素**的 computed style，而不是 CSS 变量。
     *
     * 变量正确不等于元素读得出来 —— 中间还隔着继承、`background-color` 是
     * `transparent`、以及画布上文字压在 canvas 上（背景不在元素自己身上）这
     * 几种情况。图例计数、清单里的名称与百分比是学习者真正在看的文字。
     */
    const text = await page.evaluate(READ_TEXT_COLORS);
    const textPairs: Array<[string, string, string, number]> = [
      ['画布提示文字', text.hintFg, text.canvasBg, 4.5],
      ['图例项文字', text.legendFg, text.legendBg, 4.5],
      ['图例计数', text.legendCountFg, text.legendBg, 4.5],
      ['图例总数', text.legendTotalFg, text.legendBg, 4.5],
      ['清单名称', text.rosterNameFg, text.rosterBg, 4.5],
      ['清单状态', text.rosterStateFg, text.rosterBg, 4.5],
      ['清单百分比', text.rosterPercentFg, text.rosterBg, 4.5],
      ['图例着色点', text.legendGlyph, text.legendBg, 3],
    ];
    const toHex = (value: string) => (value.startsWith('#') ? value : rgbToHex(value));
    console.log(`\n[${theme}] 真实元素取色`, text);
    const missing = textPairs.filter(([, fg, bg]) => fg === '' || bg === '');
    expect(missing.map(([name]) => name), `${theme} 有元素没取到颜色`).toEqual([]);
    const textTable = textPairs.map(([name, fg, bg, min]) => {
      const ratio = contrast(toHex(fg), toHex(bg));
      return { name, fg, bg, ratio: Number(ratio.toFixed(2)), min, ok: ratio >= min };
    });
    console.log(`\n[${theme}] 真实元素对比度`);
    console.table(textTable);
    for (const row of textTable) {
      expect(row.ok, `${theme} / ${row.name}: ${row.ratio}:1 < ${row.min}:1`).toBe(true);
    }
  });
}
