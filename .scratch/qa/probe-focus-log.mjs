/** 一次性探针：?kp= 焦点徽标是否显示名字、日志行能否点回卡片、刷新后表单是否回来。 */
import { chromium } from '@playwright/test';

const WEB = 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto(`${WEB}/?kp=kp-bool`);
await page.waitForTimeout(4000);
const badge = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('body *')];
  const idx = rows.findIndex((e) => e.textContent?.trim() === '当前知识点');
  const holder = idx >= 0 ? rows[idx].parentElement : null;
  return holder ? holder.innerText.replace(/\s+/g, ' ').slice(0, 120) : '(未找到)';
});
console.log('焦点行 =', badge);

// 提交一轮，产出关卡卡
await page.getByLabel('这一轮想说的话').fill('给我一张关卡，我想做题。');
const resp = page.waitForResponse(
  (r) => r.url().includes('/api/v1/agent/turns') && r.request().method() === 'POST',
  { timeout: 180000 },
);
await page.getByRole('button', { name: '提交这一轮' }).click();
await (await resp).json();
await page.waitForTimeout(2000);
console.log('提交后 URL =', page.url());

// 刷新，看卡片是否还在、日志行是否可点回
await page.reload();
await page.waitForTimeout(3000);
const afterReload = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
console.log('刷新后仍有「进入关卡」按钮:', afterReload.includes('进入关卡'));
console.log('刷新后焦点行 =', await page.evaluate(() => {
  const rows = [...document.querySelectorAll('body *')];
  const idx = rows.findIndex((e) => e.textContent?.trim() === '当前知识点');
  const holder = idx >= 0 ? rows[idx].parentElement : null;
  return holder ? holder.innerText.replace(/\s+/g, ' ').slice(0, 120) : '(未找到)';
}));

// 点日志第一行
const firstLog = page.locator('button', { hasText: /关卡|追问|图谱|进度/ }).first();
console.log('日志行按钮数 =', await page.locator('button', { hasText: /关卡|追问|图谱|进度/ }).count());
if (await firstLog.count()) {
  await firstLog.click();
  await page.waitForTimeout(2500);
  const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  console.log('点日志后出现「进入关卡」:', t.includes('进入关卡'));
  console.log('点日志后 URL =', page.url());
}
await browser.close();
