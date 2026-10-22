/**
 * t58 取证：换皮前的五页截图（深色/明亮各一套）。
 *
 * 为什么要「前」：票面要求每页 before/after 截图路径。before 必须在动 CSS 之前拍，
 * 之后无法重建（同一份代码只会存在一版）。
 *
 * 跑法：node .scratch/qa/capture-ray-before.mjs
 */
// 从 `@playwright/test` 取 `chromium`：仓库里没有直接装 `playwright` 包，
// 只装了 `@playwright/test`（它 re-export 了浏览器启动器）。
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('.scratch/qa/shots');
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  ['/', 'home'],
  ['/board', 'board'],
  ['/placement', 'placement'],
  ['/skills', 'skills'],
  ['/database', 'database'],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
const page = await ctx.newPage();

const report = [];
for (const theme of ['dark', 'light']) {
  await page.goto('http://localhost:5173/');
  await page.evaluate((t) => {
    window.localStorage.setItem('starmap.theme', t);
    document.documentElement.setAttribute('data-sm-theme', t);
    document.documentElement.setAttribute('data-sm-mode', t);
  }, theme);
  for (const [route, slug] of PAGES) {
    await page.goto(`http://localhost:5173${route}`);
    await page.waitForTimeout(1200);
    const file = path.join(OUT, `before-${slug}-${theme}.png`);
    await page.screenshot({ path: file });
    report.push({ theme, slug, file: path.relative(process.cwd(), file) });
  }
}

await browser.close();
fs.writeFileSync(path.join(OUT, '_before.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
