/** 探针：日志行能否点回卡片（用 aria-label 精确定位），以及刷新后卡片是否恢复。 */
import { chromium } from '@playwright/test';

const WEB = 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto(`${WEB}/?kp=kp-bool`);
await page.waitForTimeout(3500);

await page.getByLabel('这一轮想说的话').fill('给我一张关卡，我想做题。');
const resp = page.waitForResponse(
  (r) => r.url().includes('/api/v1/agent/turns') && r.request().method() === 'POST',
  { timeout: 180000 },
);
await page.getByRole('button', { name: '提交这一轮' }).click();
await (await resp).json();
await page.waitForTimeout(2000);
console.log('提交后有「进入关卡」:', (await page.evaluate(() => document.body.innerText)).includes('进入关卡'));

const rows = page.locator('[role="button"][aria-label^="第 "]');
console.log('日志行数 =', await rows.count());
console.log('日志行 aria-label =', await rows.first().getAttribute('aria-label').catch(() => '(无)'));

await page.reload();
await page.waitForTimeout(3500);
console.log('刷新后日志行数 =', await page.locator('[role="button"][aria-label^="第 "]').count());
console.log('刷新后有「进入关卡」:', (await page.evaluate(() => document.body.innerText)).includes('进入关卡'));

// 点日志第一行
const afterReloadRows = page.locator('[role="button"][aria-label^="第 "]');
if (await afterReloadRows.count()) {
  await afterReloadRows.first().click();
  await page.waitForTimeout(3000);
  const t = await page.evaluate(() => document.body.innerText);
  console.log('点日志后出现「进入关卡」:', t.includes('进入关卡'));
  console.log('点日志后 URL =', page.url());
  console.log('点日志后中间区域片段 =', t.replace(/\s+/g, ' ').slice(200, 560));
}
await browser.close();
