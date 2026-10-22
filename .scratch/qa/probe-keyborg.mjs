/**
 * 一次性探针：确认 "Keyborg instance k1 is being disposed incorrectly." 的来源。
 *
 * 三种情形分别看它出现几次：
 *   A. 只打开 '/' 一次（单路由，无跨路由导航）
 *   B. 打开 '/' 后在站内点击两次顶栏（跨路由导航）
 *   C. 新开 page，直接打开 '/skills'（另一个入口）
 */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5173';

const browser = await chromium.launch();
const ctx = await browser.newContext();

async function collect(page) {
  const hits = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') hits.push(msg.text().slice(0, 160));
  });
  page.on('pageerror', (e) => hits.push('pageerror: ' + e.message.slice(0, 160)));
  return hits;
}

// A
const a = await ctx.newPage();
const hitsA = await collect(a);
await a.goto(BASE + '/', { waitUntil: 'networkidle' });
await a.waitForTimeout(1500);
console.log('A 单路由 / 控制台错误:', JSON.stringify(hitsA, null, 1));

// B：同一个 page 再导航两次
hitsA.length = 0;
await a.getByRole('tab', { name: '知识地图' }).click();
await a.waitForTimeout(1200);
await a.getByRole('tab', { name: '看板' }).click();
await a.waitForTimeout(1200);
console.log('B 站内导航两次后新增:', JSON.stringify(hitsA, null, 1));

// C：另一个全新 page 直接进 /skills
const c = await ctx.newPage();
const hitsC = await collect(c);
await c.goto(BASE + '/skills', { waitUntil: 'networkidle' });
await c.waitForTimeout(1500);
console.log('C 新 page 直开 /skills:', JSON.stringify(hitsC, null, 1));

await browser.close();
