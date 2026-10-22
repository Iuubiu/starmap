/** 探针：追问记录（trail）是否累积；以及退出后作答区是否收起。 */
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
console.log('首轮 probeId =', first.artifact?.probeId);

for (let i = 0; i < 5; i += 1) {
  const box = page.getByLabel('追问作答');
  const radios = page.getByRole('radio');
  if (await box.count()) await box.fill('不知道。');
  else if (await radios.count()) await radios.first().check();
  else {
    console.log('既无作答框也无单选项，停止');
    break;
  }
  await page.waitForTimeout(150);
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
  await page.waitForTimeout(800);
  const trail = await page.evaluate(() => {
    const el = document.querySelector('[aria-label="追问记录"]');
    return el ? el.innerText.replace(/\s+/g, ' ') : '(无追问记录节点)';
  });
  console.log(`轮 ${i + 1}: action=${body.action} exited=${body.ladder.exited} probeId=${body.probeId ?? '(无)'}`);
  console.log(`   trail = ${trail}`);
  if (body.ladder.exited) {
    const after = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    console.log('  退出后「追问记录」在页面里 =', after.includes('第 1 轮'));
    console.log('  退出后作答框 =', await page.getByLabel('追问作答').count());
    await page.screenshot({ path: 'shots/probe-exit.png' });
    break;
  }
}
await browser.close();
