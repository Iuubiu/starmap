/**
 * 场景 20 失败归因：是「页面卡在 loading」还是「上游回合没在超时内返回」。
 *
 * 做法：完全照 03-twenty 场景 20 的流程走，但把 POST /agent/turns 的**起止时刻**
 * 与「不确定态 progressbar 存续时长」都记下来。若 progressbar 一直存在而 POST
 * 也一直未返回 → 是上游慢，不是 UI 卡死。
 */
import { chromium } from '@playwright/test';

const WEB = 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage();

const turnLog = [];
page.on('request', (r) => {
  if (r.url().includes('/api/v1/agent/turns') && r.method() === 'POST') {
    turnLog.push({ phase: 'start', t: Date.now(), url: r.url() });
  }
});
page.on('response', (r) => {
  if (r.url().includes('/api/v1/agent/turns')) {
    turnLog.push({ phase: 'end', t: Date.now(), status: r.status() });
  }
});
page.on('requestfailed', (r) => {
  if (r.url().includes('/api/v1/agent/turns')) {
    turnLog.push({ phase: 'failed', t: Date.now(), err: r.failure()?.errorText });
  }
});

const indeterminate = () =>
  page.evaluate(() => {
    const els = [...document.querySelectorAll('[role="progressbar"]:not([aria-valuenow])')];
    return els.map((e) => (e.getAttribute('aria-label') ?? '') + '|' + (e.parentElement?.innerText ?? '').slice(0, 60).replace(/\s+/g, ' '));
  });

const t0 = Date.now();
await page.goto(WEB + '/');
await page.waitForTimeout(3000);
console.log('初始 indeterminate:', JSON.stringify(await indeterminate()));

const box = page.getByLabel('这一轮想说的话');
await box.fill('刷新保持测试');
const tSubmit = Date.now();
await box.press('Enter');

// 每 2s 采样一次，最多 90s
let settledAt = null;
for (let i = 0; i < 45; i += 1) {
  await page.waitForTimeout(2000);
  const ind = await indeterminate();
  const elapsed = Date.now() - tSubmit;
  if (i % 5 === 0 || ind.length === 0) {
    console.log(`t+${(elapsed / 1000).toFixed(1)}s indeterminate=${ind.length} ${JSON.stringify(ind)}`);
  }
  if (ind.length === 0) {
    settledAt = elapsed;
    break;
  }
}
console.log('\nsettled after submit:', settledAt === null ? 'NEVER(>90s)' : `${(settledAt / 1000).toFixed(1)}s`);
console.log('turn events:', JSON.stringify(turnLog.map((e) => ({ ...e, t: ((e.t - t0) / 1000).toFixed(1) + 's' })), null, 1));

const mainText = await page.getByRole('main').innerText();
console.log('\n含「刷新保持测试」:', mainText.includes('刷新保持测试'));
console.log('含「再试一次」（降级卡）:', mainText.includes('再试一次'));

await page.reload();
await page.waitForTimeout(4000);
console.log('\n刷新后 indeterminate:', JSON.stringify(await indeterminate()));
const after = await page.getByRole('main').innerText();
console.log('刷新后含「刷新保持测试」:', after.includes('刷新保持测试'));
console.log('刷新后 main 长度:', after.length);

await browser.close();
