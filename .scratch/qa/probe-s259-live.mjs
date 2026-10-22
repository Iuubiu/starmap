/**
 * 一次性探针：在真实浏览器里走 S2（关卡卡→进入关卡）/ S5（追问表单→提交）/ S9（刷新恢复）。
 * 断言一律走界面；这里只把「实际发生了什么」打印出来。
 */
import { chromium } from '@playwright/test';

const WEB = 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('Keyborg')) errors.push(`console: ${m.text()}`);
});

const settle = async (ms = 1200) => page.waitForTimeout(ms);

// ---------- S2：带 ?kp= 冷启动 → 要一张关卡 ----------
await page.goto(`${WEB}/?kp=kp-bool`);
await settle();
const focusBadge = await page.evaluate(() =>
  document.body.innerText.includes('布尔代数基本运算'),
);
console.log('S2 焦点徽标显示布尔代数基本运算:', focusBadge);

await page.getByLabel('这一轮想说的话').fill('给我一张关卡，我想做题。');
const resp = page.waitForResponse(
  (r) => r.url().includes('/api/v1/agent/turns') && r.request().method() === 'POST',
  { timeout: 180000 },
);
await page.getByRole('button', { name: '提交这一轮' }).click();
const body = await (await resp).json();
console.log('S2 artifact kind =', body.artifact?.kind, 'levelId =', body.artifact?.levelId);

await settle(2000);
const cardText = await page.evaluate(() => document.body.innerText);
console.log('S2 卡上有 rationale:', cardText.includes(body.artifact?.rationale?.slice(0, 10) ?? '@@@'));
const enter = page.getByRole('button', { name: '进入关卡' });
console.log('S2 「进入关卡」按钮存在:', await enter.count());
if (await enter.count()) {
  await enter.click();
  await settle(2500);
  console.log('S2 点后 URL =', page.url());
  const h1 = await page.locator('h1').first().innerText().catch(() => '(无 h1)');
  console.log('S2 关卡 H1 =', h1);
}

// ---------- S5：追问表单 ----------
const page2 = await browser.newPage();
page2.on('pageerror', (e) => errors.push(`p2 pageerror: ${e.message}`));
await page2.goto(`${WEB}/?kp=kp-bool`);
await page2.waitForTimeout(1200);
await page2.getByLabel('这一轮想说的话').fill('先别给答案，问我一个问题。');
const resp2 = page2.waitForResponse(
  (r) => r.url().includes('/api/v1/agent/turns') && r.request().method() === 'POST',
  { timeout: 180000 },
);
await page2.getByRole('button', { name: '提交这一轮' }).click();
const body2 = await (await resp2).json();
console.log('S5 artifact kind =', body2.artifact?.kind, 'probeId =', body2.artifact?.probeId);
await page2.waitForTimeout(2000);
const hasAnswerBox = await page2.getByLabel('追问作答').count();
const hasChoice = await page2.getByRole('radio').count();
console.log('S5 自由文本作答框:', hasAnswerBox, '单选项:', hasChoice);
console.log('S5 面板文本:', (await page2.evaluate(() => document.body.innerText)).slice(0, 400).replace(/\s+/g, ' '));

// 填一个答案并提交
if (hasAnswerBox) {
  await page2.getByLabel('追问作答').fill('吸收律说的是 A + A·B = A。');
} else if (hasChoice) {
  await page2.getByRole('radio').first().check();
}
const replyResp = page2.waitForResponse(
  (r) => r.url().includes('/api/v1/agent/probes') && r.request().method() === 'POST',
  { timeout: 180000 },
);
await page2.getByRole('button', { name: '提交这一问的回答' }).click();
const rr = await replyResp;
const rbody = await rr.json();
console.log('S5 提交到 =', rr.url().replace(WEB, ''), 'status =', rr.status());
console.log('S5 响应键 =', Object.keys(rbody).join(','), '| action =', rbody.action, '| verdict =', rbody.verdict);
await page2.waitForTimeout(1500);
console.log('S5 提交后作答框还在吗:', await page2.getByLabel('追问作答').count());

// ---------- S9：刷新恢复 ----------
const before = await page2.evaluate(() => localStorage.getItem('starmap.session'));
await page2.reload();
await page2.waitForTimeout(2500);
const after = await page2.evaluate(() => localStorage.getItem('starmap.session'));
console.log('S9 sessionId 刷新前后一致:', before === after, before, after);
const logRows = await page2.locator('[class*=logItem], [class*=turnRow]').count();
const bodyText = await page2.evaluate(() => document.body.innerText);
console.log('S9 日志行数(粗):', logRows, '| 文本含「还没有记录」:', bodyText.includes('还没有记录'));
console.log('S9 刷新后前 300 字:', bodyText.replace(/\s+/g, ' ').slice(0, 300));

console.log('---- errors ----');
console.log(errors.join('\n') || '(none)');
await browser.close();
