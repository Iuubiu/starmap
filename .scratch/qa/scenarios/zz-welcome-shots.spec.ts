import { expect, test } from '@playwright/test';

/**
 * 票 78 的临时截图脚本（跑完即删，最终树里只留 3 张 png）。
 *
 * 为什么用真实浏览器而不是 jsdom：`FirstVisitGate` 依赖 localStorage 与真实路由
 * 重定向，`/me` 又依赖真实后端画像接口 —— 这两件事在 jsdom 里都只能被 mock 掉，
 * 拍出来的图也就不能证明「第一次进来的人会看到什么」。
 */
test.use({ viewport: { width: 1280, height: 800 } });

const SHOTS = '../../.scratch/qa/shots';

test('初识一问一答三张图 + 完成后不再自动跳', async ({ page }) => {
  await page.goto('/');
  // ① 第一次访问 / 自动跳欢迎页。
  await expect(page).toHaveURL(/\/welcome$/, { timeout: 30_000 });
  await expect(page.getByText('先认识你一下')).toBeVisible();
  await expect(page.locator('[data-question-id]')).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/welcome-1-first-question.png` });
  const firstQuestion = await page.locator('[data-question-id]').getAttribute('data-question-id');

  // 答第 1 题（点第一个选项再「继续」）。
  await page.locator('[data-question-id] [role="radiogroup"] button').first().click();
  await page.getByRole('button', { name: '继续' }).click();

  // ② 答到第 3 题再截一张：进度点、题干、选项都在一屏里。
  for (let i = 0; i < 2; i += 1) {
    const group = page.locator('[data-question-id] [role="group"], [data-question-id] [role="radiogroup"]');
    await group.first().locator('button').first().click();
    await page.getByRole('button', { name: /继续|完成，去我的页面/ }).click();
  }
  await expect(page.getByText(/第 \d+\/8 问/)).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/welcome-2-midway.png` });

  // ③ 剩下的全跳过，落到 /me。
  for (let i = 0; i < 12; i += 1) {
    if (page.url().endsWith('/me')) break;
    // 选项文案里也可能出现「跳过」（如「推导可以跳过」），所以必须 exact。
    await page.getByRole('button', { name: '跳过', exact: true }).click();
    await page.waitForTimeout(150);
  }
  await expect(page).toHaveURL(/\/me$/, { timeout: 30_000 });
  const card = page.getByRole('region', { name: '学习者画像' });
  await expect(card).toBeVisible();
  await expect(page.getByText(/未填写/).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/welcome-3-profile.png` });

  // ④ 完成后再进 / 不再被拽回欢迎页。
  await page.goto('/');
  await expect(page).not.toHaveURL(/\/welcome$/);
  console.log(JSON.stringify({ firstQuestion, finalUrl: page.url() }));
});
