/** 核对 S9 空态文案：带 ?kp= 且日志非空时，中间卡说的是什么。 */
import { chromium } from '@playwright/test';

const WEB = 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${WEB}/?kp=kp-bool`);
await page.waitForTimeout(2500);

await page.getByLabel('这一轮想说的话').fill('给我一张关卡，我想做题。');
const r = page.waitForResponse(
  (x) => x.url().includes('/api/v1/agent/turns') && x.request().method() === 'POST',
  { timeout: 180000 },
);
await page.getByRole('button', { name: '提交这一轮' }).click();
await (await r).json();
await page.waitForTimeout(1500);

await page.reload();
await page.waitForTimeout(3500);

const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
console.log('刷新后含「还没有选定知识点」=', text.includes('还没有选定知识点'));
console.log('刷新后含「共 1 轮记录」=', text.includes('共 1 轮记录'));
console.log('刷新后含「进入关卡」=', text.includes('进入关卡'));
const badge = await page.evaluate(() => {
  const b = [...document.querySelectorAll('[class*="badge"], span')].map((n) => n.textContent ?? '');
  return b.filter((s) => s.includes('布尔') || s.includes('kp-bool')).slice(0, 4);
});
console.log('焦点徽标候选 =', badge);
console.log('片段 =', text.slice(0, 260));

// 点日志第一行，看能否恢复卡片
const row = page.getByRole('button', { name: /第 1 轮/ });
console.log('日志行数 =', await row.count());
if (await row.count()) {
  await row.first().click();
  await page.waitForTimeout(2500);
  const t2 = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  console.log('点回后含「进入关卡」=', t2.includes('进入关卡'), '| 仍含空态=', t2.includes('还没有选定知识点'));
}
await browser.close();
