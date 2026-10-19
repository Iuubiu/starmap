import { test, expect } from '@playwright/test';

/**
 * 票 01 的最小闭环：页面能打开、能看到后端真实数据、能点进详情。
 *
 * 断言对象是**数据本身**（知识点名字、百分比），不是「页面上有某个 class」。
 * class 名会被重构改掉，数据不会。
 */
test('看板显示后端真实知识点', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('核电子学学习工作站')).toBeVisible();
  await expect(page.getByText('布尔代数基本运算')).toBeVisible();
  await expect(page.getByText('卡诺图化简')).toBeVisible();
});

test('顶栏显示数据库时间（证明后端连上了真库）', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/数据库 \d{2}:\d{2}:\d{2}/)).toBeVisible();
});

test('从看板点进知识点详情', async ({ page }) => {
  await page.goto('/');
  await page.getByText('布尔代数基本运算').click();
  await expect(page).toHaveURL(/\/map\/kp-bool/);
  await expect(page.getByText('66%')).toBeVisible();
  await expect(page.getByText('布尔代数的三条基本律')).toBeVisible();
  await expect(page.getByText(/还没有稳定/)).toBeVisible();
});

test('证据不足的知识点显示「证据不足」而不是 0%', async ({ page }) => {
  await page.goto('/map/kp-kmap');
  await expect(page.getByText('证据不足').first()).toBeVisible();
});

test('知识地图页列出叶节点', async ({ page }) => {
  await page.goto('/map');
  await expect(page.getByText('卡诺图化简')).toBeVisible();
  await expect(page.getByText('已熟悉')).toBeVisible();
});

test('六个页面路由都能打开，占位页说明「将来干什么」而不是「建设中」', async ({ page }) => {
  await page.goto('/database');
  await expect(page.getByRole('heading', { name: '数据库' })).toBeVisible();
  await expect(page.getByText(/数据浏览器与检索调试器尚未实现/)).toBeVisible();

  await page.goto('/skills');
  await expect(page.getByRole('heading', { name: '技能库' })).toBeVisible();

  await page.goto('/level/lv-bool-1');
  await expect(page.getByRole('heading', { name: '关卡' })).toBeVisible();
  await expect(page.getByText(/票 04/)).toBeVisible();
});

test('顶栏导航能切换到数据库页', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: '数据库' }).click();
  await expect(page).toHaveURL(/\/database/);
});
