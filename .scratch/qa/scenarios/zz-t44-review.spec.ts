/**
 * t44 独立评审探针（reviewer-2 自用；**不复用**实现者 layout.test.ts 里的断言函数）。
 *
 * 目的：在真实浏览器里量「默认视野下 5495 个节点到底能不能逐点分开」，
 * 并把结论落成可重跑的数字。与实现者度量的区别：
 *   1. 实现者数的是「布局坐标解析投影后，最近邻距离 >= 直径」的节点占比；
 *      这里数的是**渲染出来的像素**（用户真正看到的东西）——8-连通墨迹团数、
 *      最大团占比、内圈墨迹占比、单位面积墨迹覆盖率。
 *   2. 这里额外量两件实现者没量的事：
 *      - **可点击性**：在画布网格上真的点下去，看会不会导航到 `/map/<id>`。
 *        `nodePickingPadding: 8` 把命中区撑到约 19px，这是可用性的关键，但也
 *        可能让「点空白处」误导航。
 *      - **两帧稳定性**：间隔 3s 再截一张，字节相同说明布局已收敛。
 *
 * 跑法（必须带 --output，否则会踩共享 test-results 的并发坑）：
 *
 *   cd apps/web
 *   npx playwright test --config=../../.scratch/qa/playwright.config.ts \
 *     scenarios/zz-t44-review.spec.ts \
 *     --output=../../.scratch/pw-t44-review-<ts>
 *
 * 产物落在 <output>/t44-review/ 下（由 PLAYWRIGHT_OUTPUT_DIR 决定，缺省
 * ../../.scratch/pw-t44-review-manual），Python 侧再解码 PNG。
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const READY = 90_000;
const TAG = process.env.T44_TAG ?? 'base';
test.describe.configure({ timeout: 300_000 });

function shotDir(): string {
  const root = process.env.PLAYWRIGHT_OUTPUT_DIR ?? '../../.scratch/pw-t44-review-manual';
  const dir = path.resolve(process.cwd(), root, 't44-review');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function settle(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/map', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.graph-canvas')).toBeVisible({ timeout: READY });
  // 布局预算 LAYOUT_BUDGET_MS = 4s，留足余量等 worker 停下、相机稳定
  await page.waitForTimeout(9_000);
}

test('t44 评审：默认视野的真实像素证据', async ({ page }) => {
  const dir = shotDir();
  await settle(page);

  const canvas = page.locator('.graph-canvas');
  const box = (await canvas.boundingBox())!;
  const attrs = await canvas.evaluate((el) => ({
    nodeCount: el.getAttribute('data-node-count'),
    labelsVisible: el.getAttribute('data-labels-visible'),
    labelsDisplayed: el.getAttribute('data-labels-displayed'),
    cameraRatio: el.getAttribute('data-camera-ratio'),
    layoutSource: el.getAttribute('data-layout-source'),
    webglCanvases: document.querySelectorAll('canvas').length,
  }));

  const png = path.join(dir, `${TAG}-canvas-1x.png`);
  await canvas.screenshot({ path: png, animations: 'disabled' });

  await page.waitForTimeout(3_000);
  const png2 = path.join(dir, `${TAG}-canvas-1x-late.png`);
  await canvas.screenshot({ path: png2, animations: 'disabled' });
  const stable = fs.readFileSync(png).equals(fs.readFileSync(png2));

  // 放大 4 档：人想「看清一个点」时的实际手段
  for (let i = 0; i < 4; i += 1) {
    await page.getByRole('button', { name: '放大图谱' }).click();
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(1_500);
  const pngZoom = path.join(dir, `${TAG}-canvas-zoom4.png`);
  await canvas.screenshot({ path: pngZoom, animations: 'disabled' });
  const zoomAttrs = await canvas.evaluate((el) => ({
    cameraRatio: el.getAttribute('data-camera-ratio'),
    labelsDisplayed: el.getAttribute('data-labels-displayed'),
  }));

  fs.writeFileSync(
    path.join(dir, `${TAG}-metrics.json`),
    JSON.stringify({ tag: TAG, box, attrs, zoomAttrs, stable, png, png2, pngZoom }, null, 2),
    'utf8',
  );
  // eslint-disable-next-line no-console
  console.log(`[${TAG}]`, JSON.stringify({ attrs, zoomAttrs, stable, box }));

  expect(Number(attrs.nodeCount)).toBeGreaterThan(5_000);
  expect(attrs.layoutSource).toBe('worker');
});

test('t44 评审：画布上点下去会不会打开节点（nodePickingPadding 的兑现与副作用）', async ({ page }) => {
  const dir = shotDir();
  await settle(page);

  const box = (await page.locator('.graph-canvas').boundingBox())!;
  // 5x4 = 20 个均匀网格点，只点画布中部 80%（避开缩放按钮与提示条）
  const spots: Array<{ x: number; y: number }> = [];
  for (let gx = 1; gx <= 5; gx += 1) {
    for (let gy = 1; gy <= 4; gy += 1) {
      spots.push({
        x: box.x + (box.width * gx) / 6,
        y: box.y + (box.height * gy) / 5,
      });
    }
  }

  const tried: Array<{ x: number; y: number; hit: boolean; url: string }> = [];
  for (const spot of spots) {
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(350);
    const url = page.url();
    const hit = /\/map\/kp-/.test(url);
    tried.push({ x: Math.round(spot.x), y: Math.round(spot.y), hit, url });
    if (hit) {
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
      await expect(page.locator('.graph-canvas')).toBeVisible({ timeout: READY });
      await page.waitForTimeout(9_000);
    }
  }

  const hits = tried.filter((t) => t.hit).length;
  fs.writeFileSync(
    path.join(dir, `${TAG}-clickability.json`),
    JSON.stringify({ tag: TAG, spots: tried.length, hits, tried }, null, 2),
    'utf8',
  );
  // eslint-disable-next-line no-console
  console.log(`[${TAG}] 点击命中 ${hits}/${tried.length}`);

  expect(tried.length).toBe(spots.length);
});
