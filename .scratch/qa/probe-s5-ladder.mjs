/** 探针：S5 空提交拦截 + 追问阶梯走到底 + S9 刷新后输入框可聚焦。 */
import { chromium } from '@playwright/test';

const WEB = 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto(`${WEB}/?kp=kp-bool`);
await page.waitForTimeout(3500);
await page.getByLabel('这一轮想说的话').fill('先别给答案，问我一个问题。');
const r = page.waitForResponse(
  (x) => x.url().includes('/api/v1/agent/turns') && x.request().method() === 'POST',
  { timeout: 180000 },
);
await page.getByRole('button', { name: '提交这一轮' }).click();
await (await r).json();
await page.waitForTimeout(2000);

// 空提交：按钮应 disabled
const btn = page.getByRole('button', { name: '提交这一问的回答' });
console.log('空输入时「提交这一问的回答」disabled =', await btn.isDisabled());
const box = page.getByLabel('追问作答');
console.log('作答框可见 =', await box.isVisible(), '| 可聚焦 =', await box.evaluate((el) => { el.focus(); return document.activeElement === el; }));

// 填空白字符呢
await box.fill('   ');
await page.waitForTimeout(300);
console.log('只填空格时 disabled =', await btn.isDisabled());

// 连答 5 轮，看阶梯是否收敛
let last = null;
for (let i = 0; i < 5; i += 1) {
  await page.getByLabel('追问作答').fill('不知道。');
  await page.waitForTimeout(200);
  const b = page.getByRole('button', { name: '提交这一问的回答' });
  if (!(await b.count()) || (await b.isDisabled())) {
    console.log(`第 ${i + 1} 轮：按钮不可用（已收起或已退出），停止`);
    break;
  }
  const rr = page.waitForResponse(
    (x) => x.url().includes('/api/v1/agent/probes') && x.request().method() === 'POST',
    { timeout: 180000 },
  );
  await b.click();
  const res = await rr;
  last = await res.json();
  console.log(
    `第 ${i + 1} 轮 action=${last.action} ladder=${JSON.stringify(last.ladder)} 作答框还在=${await page.getByLabel('追问作答').count()}`,
  );
}
const trailText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
console.log('追问记录区出现 =', trailText.includes('追问记录'), '| 片段:', trailText.slice(trailText.indexOf('追问记录'), trailText.indexOf('追问记录') + 120));

// S9：刷新后输入框仍可聚焦
await page.reload();
await page.waitForTimeout(3000);
const composer = page.getByLabel('这一轮想说的话');
console.log('刷新后输入框可见 =', await composer.isVisible());
await composer.click();
console.log('刷新后可聚焦 =', await composer.evaluate((el) => document.activeElement === el));
const t2 = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
console.log('刷新后重复首轮问候（出现两次同一句引导）=', (t2.match(/说一句你想学什么/g) ?? []).length);
await browser.close();
