import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const browser = await chromium.launch();
for (const tier of ['P1', 'P2', 'P3']) {
  execFileSync('node', ['.scratch/demo-set-tier.mjs', tier], { cwd: ROOT, stdio: 'ignore' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5173/level/lv-bool-laws');
  await page.waitForTimeout(2500);
  const main = await page.locator('main').innerText();
  const details = await page.locator('details').count();
  const openDetails = await page.locator('details[open]').count();
  const plan = await page.request.get('http://127.0.0.1:3001/api/v1/tier/levels/lv-bool-laws/plan').then(r => r.json());
  console.log(`\n===== ${tier} =====`);
  console.log('plan.firstRound', JSON.stringify(plan.firstRound), 'tier', plan.tier);
  console.log('details', details, 'open', openDetails);
  console.log('MAIN>>', main.replace(/\s+/g, ' ').slice(0, 700));
  await ctx.close();
}
await browser.close();
