import { test } from '@playwright/test';

/**
 * 截图快照（不是断言测试，只用于人工核对视觉）。
 *
 * 放在 e2e 目录下用 Playwright Test 跑，是为了复用它已经起好的 webServer，
 * 而不是另写一套浏览器启动逻辑。
 */
test('截图：数据库页', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/database');
  await page.getByText('来源追溯', { exact: true }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: '.scratch/shot-db-database.png' });
});

test('截图：看板、学习与地图', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // 看板在 `/board`；`/` 现在是智能体主页。两处都截 —— 票 08 换了首页之后
  // 「看板跑到别的路由去了」这种回归，只有截图能一眼看出来。
  await page.goto('/board');
  await page.getByText('核电子学学习工作站').waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: '.scratch/shot-db-dashboard.png' });

  await page.goto('/');
  await page.waitForTimeout(800);
  await page.screenshot({ path: '.scratch/shot-db-home.png' });

  await page.goto('/map');
  await page.waitForTimeout(800);
  await page.screenshot({ path: '.scratch/shot-db-map.png' });
});
