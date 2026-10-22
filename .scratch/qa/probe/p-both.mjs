import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const KP = 'kp-bool';
const UTTER = '我想学布尔代数的基本运算';
const browser = await chromium.launch();
const out = [];
for (const tier of ['P1','P2','P3']) {
  execFileSync('node', ['.scratch/demo-set-tier.mjs', tier], { cwd: ROOT, stdio: 'ignore' });
  const ctx = await browser.newContext({ viewport:{width:1280,height:800}, locale:'zh-CN' });
  const page = await ctx.newPage();
  const tp = await page.request.get('http://127.0.0.1:3001/api/v1/tier').then(r=>r.json());
  await page.goto(`http://localhost:5173/?kp=${KP}`);
  await page.getByPlaceholder(/说说你想学什么/).fill(UTTER);
  await page.getByRole('button', { name: '提交这一轮' }).click();
  await page.getByText(/正在生成这一轮的卡片/).waitFor({state:'hidden',timeout:90000}).catch(()=>{});
  await page.waitForTimeout(1200);
  const main = (await page.locator('main').innerText()).replace(/\s+/g,' ');
  const plan = await page.request.get('http://127.0.0.1:3001/api/v1/tier/session-plan').then(r=>r.json());
  // level first screen
  const lp = await ctx.newPage();
  await lp.goto('http://localhost:5173/level/lv-bool-laws');
  await lp.waitForTimeout(2000);
  const lmain = (await lp.locator('main').innerText()).replace(/\s+/g,' ');
  const details = await lp.locator('details').count();
  const open = await lp.locator('details[open]').count();
  const lplan = await lp.request.get('http://127.0.0.1:3001/api/v1/tier/levels/lv-bool-laws/plan').then(r=>r.json());
  out.push({ tier, params: tp.params, plan: {limit: plan.limit, items: plan.items?.length, deferred: plan.deferred}, firstScreen: main.slice(0,700), levelPlan: lplan.firstRound, details, open, levelScreen: lmain.slice(0,500) });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(out,null,2));
