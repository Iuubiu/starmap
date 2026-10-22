/**
 * t74 复审：当前字节下 /map 的几何与可分度（多视口对照）。
 *
 * 目的：判断「逐点可分」在当前三列外壳下是否还成立，以及它是否依赖画布宽度。
 *
 *   cd apps/web
 *   npx playwright test --config=../../.scratch/qa/playwright.config.ts \
 *     scenarios/zz-t74f-geom.spec.ts --output=../../.scratch/pw-t74f-<ts>
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const READY = 90_000;
test.describe.configure({ timeout: 300_000 });

function outDir(): string {
  const root = process.env.PLAYWRIGHT_OUTPUT_DIR ?? '../../.scratch/pw-t74f-manual';
  const dir = path.resolve(process.cwd(), root, 't74f');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('t74f：不同视口下画布几何与节点直径', async ({ page }) => {
  const dir = outDir();
  const rows: unknown[] = [];
  for (const [w, h] of [
    [1440, 900],
    [1920, 1080],
    [2560, 1440],
    [1024, 768],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/map', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.graph-canvas')).toBeVisible({ timeout: READY });
    await page.waitForTimeout(8_000);
    const g = await page.evaluate(() => {
      const el = document.querySelector('.graph-canvas') as HTMLElement | null;
      const c = el?.querySelector('canvas') as HTMLCanvasElement | null;
      const page_ = el?.closest('.sm-page-in') as HTMLElement | null;
      const body = el?.parentElement as HTMLElement | null;
      const r = el?.getBoundingClientRect();
      const cs = c ? getComputedStyle(c) : null;
      return {
        nodeCount: el?.getAttribute('data-node-count'),
        labels: el?.getAttribute('data-labels-displayed'),
        ratio: el?.getAttribute('data-camera-ratio'),
        canvasBox: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
        pageIn: page_ ? { w: page_.clientWidth, h: page_.clientHeight } : null,
        body: body ? { w: body.clientWidth, cols: getComputedStyle(body).gridTemplateColumns } : null,
        canvasCss: c ? { w: cs?.width, h: cs?.height, cw: c.width, ch: c.height } : null,
        mainScrollH: (document.querySelector('main.sm-main') as HTMLElement | null)?.scrollHeight,
        rosterClientH: (document.querySelector('.graph-roster') as HTMLElement | null)?.clientHeight,
      };
    });
    const clip = {
      x: Math.round(g.canvasBox!.x),
      y: Math.round(g.canvasBox!.y),
      width: Math.round(g.canvasBox!.w),
      height: Math.round(g.canvasBox!.h),
    };
    await page.screenshot({ path: path.join(dir, `canvas-${w}x${h}.png`), clip });
    await page.screenshot({ path: path.join(dir, `full-${w}x${h}.png`) });
    rows.push({ viewport: `${w}x${h}`, ...g });
  }
  fs.writeFileSync(path.join(dir, 'geom.json'), JSON.stringify(rows, null, 1), 'utf8');
  console.log('WROTE', dir);
});
