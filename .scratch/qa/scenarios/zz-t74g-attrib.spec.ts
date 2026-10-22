import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const OUT = '../../.scratch/pw-t74g-manual/t74g';

test.use({ viewport: { width: 1440, height: 900 } });

test('t74g 归因：画布被三列外壳压到 340px，放宽后可分度是否回来', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto('/map');
  await page.locator('.graph-canvas').waitFor({ state: 'visible' });
  await page.waitForTimeout(9000);

  const geom = async () =>
    page.evaluate(() => {
      const pick = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          sel,
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          display: cs.display,
          gridTemplateColumns: cs.gridTemplateColumns,
          maxWidth: cs.maxWidth,
          width: cs.width,
        };
      };
      const cv = document.querySelector('.graph-canvas') as HTMLElement;
      const canvas = cv?.querySelector('canvas') as HTMLCanvasElement;
      return {
        nodes: cv?.getAttribute('data-node-count'),
        ratio: cv?.getAttribute('data-camera-ratio'),
        labels: cv?.getAttribute('data-labels-displayed'),
        chain: [
          pick('.sm-shell'),
          pick('.sm-stage'),
          pick('.sm-main'),
          pick('.sm-page-in'),
          pick('.graph-page'),
          pick('.graph-body'),
          pick('.graph-canvas'),
          pick('.graph-roster'),
        ],
        canvasBacking: canvas ? [canvas.width, canvas.height] : null,
      };
    });

  const before = await geom();
  fs.writeFileSync(`${OUT}/before.json`, JSON.stringify(before, null, 1));
  await page.locator('.graph-canvas').screenshot({ path: `${OUT}/before-canvas.png` });

  // 只改外壳的三列栅格：让内容列吃满 1106px（不改 MapPage 自己的两列）
  await page.addStyleTag({ content: '.sm-page-in{grid-template-columns:1fr !important;}' });
  // 触发 sigma resize：改一下视口再改回来
  await page.setViewportSize({ width: 1441, height: 900 });
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(9000);

  const after = await geom();
  fs.writeFileSync(`${OUT}/after.json`, JSON.stringify(after, null, 1));
  await page.locator('.graph-canvas').screenshot({ path: `${OUT}/after-canvas.png` });

  console.log('BEFORE ' + JSON.stringify(before));
  console.log('AFTER  ' + JSON.stringify(after));
  expect(before.chain[0]).toBeTruthy();
});
