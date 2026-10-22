/**
 * t74 重审 t44 — 探针 5：把「布局修复」在**首帧之前**注入，看画布正常尺寸下
 * 图是不是真的逐点可分（探针 4 的 fix 是挂载后注入的，sigma 没重新 resize，
 * 所以那张图是空的，不能作为「图不可见」的证据）。
 *
 *   cd apps/web
 *   npx playwright test --config=../../.scratch/qa/playwright.config.ts \
 *     scenarios/zz-t44e-earlyfix.spec.ts --output=../../.scratch/pw-t44e-<ts>
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const READY = 90_000;
test.describe.configure({ timeout: 300_000 });
const FIX = '.sm-page-in{height:100%;min-height:0;}';

function outDir(): string {
  const root = process.env.PLAYWRIGHT_OUTPUT_DIR ?? '../../.scratch/pw-t44e-manual';
  const dir = path.resolve(process.cwd(), root, 't44e');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function measure(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const el = document.querySelector('.graph-canvas') as HTMLElement | null;
    const c = el?.querySelector('canvas') as HTMLCanvasElement | null;
    const r = el?.getBoundingClientRect();
    const cr = c?.getBoundingClientRect();
    return {
      nodes: el?.getAttribute('data-node-count') ?? null,
      labels: el?.getAttribute('data-labels-displayed') ?? null,
      ratio: el?.getAttribute('data-camera-ratio') ?? null,
      layoutSource: el?.getAttribute('data-layout-source') ?? null,
      canvasBox: r ? { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) } : null,
      glBox: cr ? { w: Math.round(cr.width), h: Math.round(cr.height) } : null,
      backing: c ? { w: c.width, h: c.height } : null,
    };
  });
}

test('t44e：首帧前注入布局修复后量可分度', async ({ page }) => {
  const dir = outDir();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/map', { waitUntil: 'commit' });
  await page.addStyleTag({ content: FIX });
  await expect(page.locator('.graph-canvas')).toBeVisible({ timeout: READY });
  await page.waitForTimeout(9_000);

  const m = await measure(page);
  const canvas = page.locator('.graph-canvas');
  await canvas.screenshot({ path: path.join(dir, 'early-canvas.png') });
  await page.screenshot({ path: path.join(dir, 'early-viewport.png') });

  // 再等 3s 确认布局停了以后仍然稳定
  await page.waitForTimeout(3_000);
  const m2 = await measure(page);
  await canvas.screenshot({ path: path.join(dir, 'early-canvas-late.png') });

  fs.writeFileSync(path.join(dir, 'early.json'), JSON.stringify({ m, m2 }, null, 2), 'utf8');
  console.log('WROTE', dir, JSON.stringify(m));
  expect(m.nodes).not.toBeNull();
});
