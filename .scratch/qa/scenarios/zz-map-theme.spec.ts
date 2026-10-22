import { test, expect, type Page } from '@playwright/test';

/**
 * t62 验收探针 A：知识地图的两套主题。
 *
 * 回答四个问题，全部基于真实的 computed style 与真实渲染：
 * 1. 两套主题下画布都是**深色面板**，但取值不同（不是同一块黑）；
 * 2. 节点四态色、图例色随主题真的换了（从 token 流到 DOM，中途没断）；
 * 3. 切主题**不刷新**：直接改 `<html data-sm-theme>`（未来主题按钮走同一条
 *    路径），画布还在、节点数不变；
 * 4. 两套主题各出一张 1280×800 截图，供人眼复核。
 *
 * 这里只验「换色是否真的到达 DOM」，对比度数值在 zz-graph-contrast.spec.ts。
 */

test.use({ viewport: { width: 1280, height: 800 } });

const READ_CANVAS = () => {
  const canvas = document.querySelector('.graph-canvas');
  if (!canvas) return null;
  const glyph = document.querySelector('.graph-roster-glyph') as HTMLElement | null;
  const legend = document.querySelector('.graph-legend-item') as HTMLElement | null;
  const webgl = canvas.querySelector('canvas');
  return {
    theme: document.documentElement.getAttribute('data-sm-theme'),
    canvasBg: getComputedStyle(canvas).backgroundColor,
    canvasImage: getComputedStyle(canvas).backgroundImage,
    nodeCount: canvas.getAttribute('data-node-count'),
    cameraRatio: canvas.getAttribute('data-camera-ratio'),
    labelsVisible: canvas.getAttribute('data-labels-visible'),
    glyphColor: glyph ? getComputedStyle(glyph).backgroundColor : null,
    legendColor: legend ? getComputedStyle(legend).backgroundColor : null,
    webglSize: webgl ? { w: webgl.clientWidth, h: webgl.clientHeight } : null,
  };
};

async function waitForGraph(page: Page): Promise<void> {
  await page.goto('/map');
  await expect(page.locator('.graph-canvas')).toBeVisible({ timeout: 60_000 });
  // 节点数由 sigma 的 afterRender 上报；出现即布局已跑完一轮
  await expect
    .poll(
      async () => Number(await page.locator('.graph-canvas').getAttribute('data-node-count')),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(100);
  // webgl 层有尺寸才说明真的画了（ResizeObserver 已报到非零宽度）
  await expect
    .poll(
      async () =>
        (await page.locator('.graph-canvas canvas').first().evaluate((el) => el.clientWidth)) ?? 0,
      { timeout: 30_000 },
    )
    .toBeGreaterThan(200);
}

test('两套主题：画布是两档不同的深色，节点与图例随之换色', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('starmap.theme', 'dark'));
  await waitForGraph(page);
  const dark = await page.evaluate(READ_CANVAS);
  expect(dark).not.toBeNull();
  await page.waitForTimeout(500);
  await page.screenshot({ path: '../../.scratch/qa/shots/theme-map-dark.png' });

  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => localStorage.setItem('starmap.theme', 'light'));
  await waitForGraph(page);
  const light = await page.evaluate(READ_CANVAS);
  expect(light).not.toBeNull();
  await page.waitForTimeout(500);
  await page.screenshot({ path: '../../.scratch/qa/shots/theme-map-light.png' });

  console.log('DARK ', JSON.stringify(dark));
  console.log('LIGHT', JSON.stringify(light));

  expect(dark!.theme).toBe('dark');
  expect(light!.theme).toBe('light');

  // 画布两套都是深色，但**不是同一个值**（后者是 t58 的浅灰画布，已换掉）
  const rgb = (value: string) => {
    const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
    if (!match) throw new Error(`不是 rgb 颜色: ${value}`);
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
  };
  const toLum = ({ r, g, b }: { r: number; g: number; b: number }) => {
    const channel = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const darkLum = toLum(rgb(dark!.canvasBg));
  const lightLum = toLum(rgb(light!.canvasBg));
  expect(darkLum, '深色主题画布不够暗').toBeLessThan(0.05);
  expect(lightLum, '亮色主题画布不够暗（画布两套都应该是深面板）').toBeLessThan(0.05);
  expect(light!.canvasBg).not.toBe(dark!.canvasBg);

  // 网格也跟着换（背景图里内联了 `--sm-graph-canvas-grid` 的解析值）
  expect(dark!.canvasImage).toContain('radial-gradient');
  expect(light!.canvasImage).toContain('radial-gradient');
  expect(light!.canvasImage).not.toBe(dark!.canvasImage);

  // 四态色的第一通道：图例与节点清单的字形都从 palette 取色
  expect(dark!.glyphColor).not.toBeNull();
  expect(light!.glyphColor).not.toBeNull();
  expect(light!.glyphColor).not.toBe(dark!.glyphColor);

  // 图例底是页面语义色，两套主题必然不同（深色页 vs 白色页）
  expect(light!.legendColor).not.toBe(dark!.legendColor);
});

test('切主题不刷新：系统外观改变后画布仍在、节点数不变', async ({ page }) => {
  /**
   * 走**真实路径**切主题：模式设为「跟随系统」，然后用 Playwright 改系统外观。
   *
   * 为什么不直接改 `<html data-sm-theme>`：那样只换 CSS 变量与 palette 的
   * 订阅者，`ThemeProvider` 里的 Fluent 主题仍是旧的一套，页面会停在「一半
   * 亮一半暗」的中间态 —— 那不是一个用户能进入的状态，拿它当证据等于自己
   * 造了个假问题。`system` 模式 + `emulateMedia` 触发的是 `matchMedia` 的
   * change 事件，`ThemeProvider` 会同时更新 Fluent 主题与 DOM 属性，和未来
   * 主题按钮点下去的效果一致，而且**全程不导航**。
   */
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('starmap.theme', 'system'));
  await waitForGraph(page);

  const before = await page.evaluate(READ_CANVAS);
  expect(before).not.toBeNull();
  expect(before!.theme).toBe('dark');
  const canvasBefore = await page.locator('.graph-canvas').elementHandle();
  const navCount = await page.evaluate(() => performance.getEntriesByType('navigation').length);
  const loadMarks = await page.evaluate(() => performance.timeOrigin);

  await page.emulateMedia({ colorScheme: 'light' });
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.getAttribute('data-sm-theme')), {
      timeout: 10_000,
    })
    .toBe('light');
  await page.waitForTimeout(600);

  const after = await page.evaluate(READ_CANVAS);
  expect(after).not.toBeNull();
  expect(after!.theme).toBe('light');
  expect(after!.canvasBg).not.toBe(before!.canvasBg);

  // 页面 chrome 也跟着换了（Fluent 主题真的换了，不是只换了 CSS 变量）
  const pageBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(pageBg).not.toBe('rgb(21, 21, 26)');

  // 同一次文档、同一块画布：节点数不变，相机比例属性还在（不是重建画布）
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(loadMarks);
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(
    navCount,
  );
  expect(after!.nodeCount).toBe(before!.nodeCount);
  expect(after!.cameraRatio).toBe(before!.cameraRatio);
  expect(after!.webglSize?.w ?? 0).toBeGreaterThan(200);

  // 画布 DOM 节点还是原来那个（没有被 React 拆掉重建）
  const same = await page.evaluate((el) => {
    const current = document.querySelector('.graph-canvas');
    return current !== null && current === el;
  }, canvasBefore);
  expect(same, '切主题时画布被重建了').toBe(true);

  await page.screenshot({ path: '../../.scratch/qa/shots/theme-map-switch-noreload.png' });
});
