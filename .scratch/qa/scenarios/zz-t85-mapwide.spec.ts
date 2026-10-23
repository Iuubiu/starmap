/**
 * t85 评审探针（reviewer-2 自写，不复用实现者断言）：
 * 票 83 验收② —— `/map` 走 wide 模式，画布宽度 ≥ 窗口宽 - 340px。
 *
 * 只读页面、只量 DOM，不改任何源文件。
 */
import { expect, test } from '@playwright/test';

const WIDTHS = [1280, 1440, 1920, 2560] as const;
const OUT = '../../.scratch/qa/t85-mapwide';

interface Row {
  width: number;
  canvasW: number;
  canvasH: number;
  rosterW: number;
  mainW: number;
  dataWide: string | null;
  min: number;
  pass: boolean;
}

test('票83 验收②：/map 画布宽度 ≥ 窗口宽 - 340px', async ({ page }) => {
  const rows: Row[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem('profileDone', '1');
    });
    await page.goto('/map');
    await page.waitForSelector('.graph-canvas, .graph-canvas-webgl', { timeout: 30_000 });
    await page.waitForTimeout(2500);

    const canvas = page.locator('.graph-canvas, .graph-canvas-webgl').first();
    const box = await canvas.boundingBox();
    const roster = await page.locator('.graph-roster').first().boundingBox();
    const info = await page.evaluate(() => {
      const main = document.querySelector('main');
      const pageIn = document.querySelector('.sm-page-in');
      return {
        mainW: main ? main.getBoundingClientRect().width : 0,
        dataWide: pageIn ? pageIn.getAttribute('data-wide') : null,
      };
    });

    const canvasW = box?.width ?? 0;
    const min = width - 340;
    rows.push({
      width,
      canvasW: Math.round(canvasW),
      canvasH: Math.round(box?.height ?? 0),
      rosterW: Math.round(roster?.width ?? 0),
      mainW: Math.round(info.mainW),
      dataWide: info.dataWide,
      min,
      pass: canvasW >= min,
    });
    await page.screenshot({ path: `${OUT}/map-${width}.png`, fullPage: false });
  }

  const table = rows
    .map(
      (r) =>
        `| ${r.width} | ${r.canvasW} | ${r.canvasH} | ${r.rosterW} | ${r.mainW} | ${r.dataWide} | ${r.min} | ${r.pass ? 'PASS' : 'FAIL'} |`,
    )
    .join('\n');
  console.log(
    `\n| 视口 | 画布宽 | 画布高 | 清单宽 | main宽 | data-wide | 下限(宽-340) | 判定 |\n|---|---|---|---|---|---|---|---|\n${table}\n`,
  );

  expect(rows.every((r) => r.pass), `画布宽度未达「窗口宽-340」：\n${table}`).toBe(true);
});
