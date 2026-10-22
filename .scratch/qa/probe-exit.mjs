/** 探针：追问 exited 之后，作答区是否还在（该收起却仍在 = 缺陷）。 */
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
const first = await (await r).json();
await page.waitForTimeout(2000);
console.log('首轮 artifact kind =', first.artifact?.kind, '| inputKind =', first.artifact?.inputKind);

const hasBox = async () => (await page.getByLabel('追问作答').count()) > 0;
const hasRadios = async () => (await page.getByRole('radio').count()) > 0;
console.log('作答框 =', await hasBox(), '| 单选项 =', await hasRadios());

for (let i = 0; i < 5; i += 1) {
  if (await hasBox()) await page.getByLabel('追问作答').fill('不知道。');
  else if (await hasRadios()) await page.getByRole('radio').first().check();
  else {
    console.log('既无作答框也无单选项，停止');
    break;
  }
  await page.waitForTimeout(200);
  const b = page.getByRole('button', { name: '提交这一问的回答' });
  if (!(await b.count()) || (await b.isDisabled())) {
    console.log('提交按钮不可用，停止');
    break;
  }
  const rr = page.waitForResponse(
    (x) => x.url().includes('/api/v1/agent/probes') && x.request().method() === 'POST',
    { timeout: 180000 },
  );
  await b.click();
  const body = await (await rr).json();
  const after = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  console.log(
    `轮 ${i + 1}: action=${body.action} exited=${body.ladder.exited} | 作答框=${await page.getByLabel('追问作答').count()} | 提交按钮=${await page.getByRole('button', { name: '提交这一问的回答' }).count()} | 「追问已结束」=${after.includes('追问已结束')} | 「追问记录」=${after.includes('追问记录')}`,
  );
  if (body.ladder.exited) {
    console.log('  → 退出后片段:', after.slice(0, 320));
    await page.screenshot({ path: 'shots/probe-exit.png' });
    break;
  }
}
await browser.close();
