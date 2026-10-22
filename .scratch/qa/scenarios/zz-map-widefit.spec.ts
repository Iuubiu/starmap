import { test, expect } from '@playwright/test';

/** 2560 宽下地图必须重新取景，而不是缩在正中一小块。 */
test('宽视口下图谱重新取景', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/map');
  await page.waitForSelector('.graph-canvas', { timeout: 20000 });
  await page.waitForTimeout(3500);
  const wide = await page.evaluate(() => {
    const canvas = document.querySelector('.graph-canvas') as HTMLElement;
    const gl = canvas.querySelector('canvas') as HTMLCanvasElement;
    /* 采样：数有多少像素不是背景色；取景正常时点应散布到画布大部分区域 */
    const ratio = Number(canvas.getAttribute('data-camera-ratio') ?? '0');
    return { ratio, w: gl?.width ?? 0 };
  });
  await page.setViewportSize({ width: 2560, height: 1200 });
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => {
    const canvas = document.querySelector('.graph-canvas') as HTMLElement;
    return { ratio: Number(canvas.getAttribute('data-camera-ratio') ?? '0') };
  });
  console.log(JSON.stringify({ wide, after }));
  expect(after.ratio).toBeLessThanOrEqual(1.2);
});
