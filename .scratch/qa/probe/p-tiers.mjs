import { chromium } from '@playwright/test';
const UTTERANCE = '我想学布尔代数的基本运算';
const browser = await chromium.launch();
for (const tier of ['P1', 'P2', 'P3']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const t = await page.request.get('http://127.0.0.1:3001/api/v1/tier').then(r => r.json());
  await page.goto(`http://localhost:5173/?kp=kp-bool`);
  await page.getByPlaceholder(/说说你想学什么/).fill(UTTERANCE);
  await page.getByRole('button', { name: '提交这一轮' }).click();
  await page.getByText(/正在生成这一轮的卡片/).waitFor({ state: 'hidden', timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const main = await page.locator('main').innerText();
  const plan = await page.request.get('http://127.0.0.1:3001/api/v1/tier/session-plan').then(r => r.json());
  console.log(`\n===== ${tier} =====`);
  console.log('params', JSON.stringify(t.params));
  console.log('sessionPlan limit', plan.limit, 'items', plan.items?.length, 'deferred', plan.deferred);
  console.log('MAIN>>', main.replace(/\s+/g, ' ').slice(0, 900));
  await ctx.close();
}
await browser.close();
