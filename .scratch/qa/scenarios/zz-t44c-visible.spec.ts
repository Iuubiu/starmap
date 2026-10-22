/**
 * t74 重审 t44 — 探针 3：**用户默认视野里到底有没有节点**。
 *
 * 前两个探针量的是 `.graph-canvas` 元素截图（932×14626），但元素截图会越过视口
 * 拼接，WebGL 在视口外不一定真的绘制过，像素统计不可信。这里改量「用户眼睛
 * 能看到的那个 1440×900 视口」，并在把 main 滚到画布中段后再量一次作对照。
 *
 *   cd apps/web
 *   npx playwright test --config=../../.scratch/qa/playwright.config.ts \
 *     scenarios/zz-t44c-visible.spec.ts --output=../../.scratch/pw-t44c-<ts>
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const READY = 90_000;
test.describe.configure({ timeout: 300_000 });

function outDir(): string {
  const root = process.env.PLAYWRIGHT_OUTPUT_DIR ?? '../../.scratch/pw-t44c-manual';
  const dir = path.resolve(process.cwd(), root, 't44c');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function attrs(page: import('@playwright/test').Page) {
  return page.locator('.graph-canvas').evaluate((el) => ({
    nodeCount: el.getAttribute('data-node-count'),
    labelsDisplayed: el.getAttribute('data-labels-displayed'),
    cameraRatio: el.getAttribute('data-camera-ratio'),
    layoutSource: el.getAttribute('data-layout-source'),
    box: el.getBoundingClientRect().toJSON(),
    canvas: (() => {
      const c = el.querySelector('canvas');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { w: c.width, h: c.height, cssW: r.width, cssH: r.height, top: r.top };
    })(),
  }));
}

test('t44c：默认视口 vs 滚到画布中段', async ({ page }) => {
  const dir = outDir();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/map', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.graph-canvas')).toBeVisible({ timeout: READY });
  await page.waitForTimeout(9_000);

  const a1 = await attrs(page);
  await page.screenshot({ path: path.join(dir, 'view-default.png') });

  // 画布在 main.sm-main 的滚动内容里；把它滚到中段再看一次
  const scrolled = await page.evaluate(() => {
    const main = document.querySelector('main.sm-main') ?? document.querySelector('main');
    const canvas = document.querySelector('.graph-canvas') as HTMLElement | null;
    if (!main || !canvas) return null;
    const target = canvas.offsetTop + canvas.offsetHeight / 2 - main.clientHeight / 2;
    main.scrollTop = target;
    return {
      mainTag: main.className,
      scrollHeight: main.scrollHeight,
      clientHeight: main.clientHeight,
      scrollTop: main.scrollTop,
      wanted: target,
    };
  });
  await page.waitForTimeout(2_500);
  const a2 = await attrs(page);
  await page.screenshot({ path: path.join(dir, 'view-scrolled.png') });

  // 再看一眼画布正中的元素截图（此时它在视口内，WebGL 真画过）
  const canvasEl = page.locator('.graph-canvas');
  const b = (await canvasEl.boundingBox())!;
  const clipTop = Math.max(b.y, 0);
  await page.screenshot({
    path: path.join(dir, 'viewport-at-canvas-middle.png'),
  });

  fs.writeFileSync(
    path.join(dir, 'visible.json'),
    JSON.stringify({ a1, scrolled, a2, canvasBox: b, clipTop }, null, 2),
    'utf8',
  );
  console.log('WROTE', dir);
  expect(a1.nodeCount).not.toBeNull();
});
