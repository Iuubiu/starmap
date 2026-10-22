/** 探针 S9 残余：刷新后，历史里的追问卡片还能不能接着看/答。 */
import { chromium } from '@playwright/test';

const WEB = 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${WEB}/?kp=kp-bool`);
await page.waitForTimeout(2500);

// 产一张追问卡
await page.getByLabel('这一轮想说的话').fill('先别给答案，问我一个问题。');
const r = page.waitForResponse(
  (x) => x.url().includes('/api/v1/agent/turns') && x.request().method() === 'POST',
  { timeout: 180000 },
);
await page.getByRole('button', { name: '提交这一轮' }).click();
const body = await (await r).json();
await page.waitForTimeout(1500);
console.log('artifact =', body.artifact?.kind);

// 答一轮，制造 trail
if (body.artifact?.kind === 'probe_form') {
  const box = page.getByLabel('追问作答');
  if (await box.count()) await box.fill('不知道。');
  const submit = page.getByRole('button', { name: '提交这一问的回答' });
  if (await submit.count()) {
    const rr = page.waitForResponse(
      (x) => x.url().includes('/api/v1/agent/probes') && x.request().method() === 'POST',
      { timeout: 180000 },
    );
    await submit.click();
    await (await rr).json();
    await page.waitForTimeout(800);
  }
  const trailBefore = await page.getByLabel('追问记录').count();
  console.log('刷新前有追问记录节点 =', trailBefore > 0);
}

// 刷新，再从学习日志点回这一轮
await page.reload();
await page.waitForTimeout(3000);
const logEntries = await page.locator('[class*="logRow"], button:has-text("关卡"), button:has-text("追问")').count();
console.log('刷新后日志可点条目数 =', logEntries);

// 找到日志里那一轮并点开
const logButtons = page.locator('button').filter({ hasText: /追问|关卡|图谱|进度/ });
const n = await logButtons.count();
console.log('日志按钮数 =', n);
if (n > 0) {
  await logButtons.last().click();
  await page.waitForTimeout(2000);
  const trailAfter = await page.getByLabel('追问记录').count();
  const boxAfter = await page.getByLabel('追问作答').count();
  console.log('点回历史后：追问记录节点 =', trailAfter, '| 作答框 =', boxAfter);
  const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  console.log('页面片段:', t.slice(0, 300));
}
await browser.close();
