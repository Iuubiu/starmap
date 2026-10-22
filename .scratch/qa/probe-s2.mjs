/** 探针 S2：从「知识点详情 → 问助手 → 要一张关卡 → 进入关卡」整条真实路径。 */
import { chromium } from '@playwright/test';

const WEB = 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));

// 1) 顶栏进知识地图
await page.goto(WEB);
await page.waitForTimeout(3000);
await page.getByRole('tab', { name: '知识地图', exact: true }).click();
await page.waitForTimeout(3000);
const mapText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
console.log('地图页首屏:', mapText.slice(0, 200));

// 2) 知识点详情页
await page.goto(`${WEB}/map/kp-bool`);
await page.waitForTimeout(2500);
const detail = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
console.log('详情页有「问助手」=', detail.includes('问助手'));
console.log('详情页片段:', detail.slice(0, 220));

// 3) 点「问助手」回首页
await page.getByRole('button', { name: '问助手' }).click();
await page.waitForTimeout(2000);
console.log('URL =', page.url());
const home = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
const at = home.indexOf('当前知识点');
console.log('首页焦点徽标 =', home.slice(at, at + 40));

// 4) 要一张关卡
await page.getByLabel('这一轮想说的话').fill('给我一张关卡，我想做题。');
const r = page.waitForResponse(
  (x) => x.url().includes('/api/v1/agent/turns') && x.request().method() === 'POST',
  { timeout: 180000 },
);
await page.getByRole('button', { name: '提交这一轮' }).click();
const body = await (await r).json();
await page.waitForTimeout(1500);
console.log('artifact.kind =', body.artifact?.kind, '| microKpId =', body.artifact?.microKpId);
if (body.artifact?.kind === 'level_card') {
  console.log(
    '  levelId =',
    body.artifact.levelId,
    '| title =',
    body.artifact.title,
    '| items =',
    body.artifact.itemCount,
  );
}
const enterCount = await page.getByRole('button', { name: '进入关卡' }).count();
console.log('页面有「进入关卡」按钮 =', enterCount > 0);
if (enterCount > 0) {
  await page.getByRole('button', { name: '进入关卡' }).click();
  await page.waitForTimeout(3000);
  console.log('点「进入关卡」后 URL =', page.url());
  const lv = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  console.log('关卡页片段:', lv.slice(0, 260));
}
console.log('控制台错误:', errors.length ? errors.slice(0, 3) : '（无）');
await page.screenshot({ path: 'shots/s2-level-card.png', fullPage: true });
await browser.close();
