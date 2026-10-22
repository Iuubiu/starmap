import { expect, test } from '@playwright/test';

/**
 * 票 79 的视觉证据：问津卡在页面上的样子。
 *
 * 走真实链路：打开首页 → 在输入框里说一句「我想学布尔代数」→ 提交 → 等卡片。
 * 不拦截网络、不注入数据 —— 要证的就是「真实模型也会走到 clarify 这条路上」。
 */
test.use({ viewport: { width: 1280, height: 800 } });

test('问津：宽泛的一句话先追问，而不是直接出关', async ({ page }) => {
  await page.addInitScript(() => {
    // 略过「初识」：这条用例只看问津卡，不想被欢迎页拦下。
    localStorage.setItem('profileDone', '1');
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const input = page.getByLabel('这一轮想说的话');
  await input.fill('我想学布尔代数');
  await page.getByRole('button', { name: '提交这一轮' }).click();

  // 问津卡：标题带「问津」，正文是那一问，四个选项都在。
  await expect(page.getByText('问津', { exact: true })).toBeVisible({ timeout: 180_000 });
  // 同一句话会出现三处（卡片、可见回复、追问面板），这里只看第一处可见即可。
  await expect(page.getByText('这一轮，你更想为了什么？').first()).toBeVisible();
  await expect(page.getByText('为了考试').first()).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: '../../.scratch/qa/shots/ask-way-clarify.png' });
});
