/**
 * 探针：/map 首次加载各阶段耗时。用完即删。
 *   t0 goto → t1 /api/v1/graph 响应完成 → t2 清单出现 → t3 画布 data-node-count 就绪
 */
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'zh-CN' });

let graphDone = 0;
let graphStart = 0;
page.on('request', (r) => {
  if (r.url().includes('/api/v1/graph')) graphStart = Date.now();
});
page.on('response', async (r) => {
  if (r.url().includes('/api/v1/graph')) graphDone = Date.now();
});

const t0 = Date.now();
await page.goto('http://localhost:5173/map');
await page.waitForSelector('.graph-roster-item', { timeout: 90_000 });
const t2 = Date.now();
await page.waitForFunction(
  () => {
    const el = document.querySelector('.graph-canvas');
    return el && Number(el.getAttribute('data-node-count')) > 0;
  },
  undefined,
  { timeout: 90_000 },
);
const t3 = Date.now();

const optionCount = await page.locator('select option').count();
console.log(
  JSON.stringify(
    {
      graphRequestStart: graphStart - t0,
      graphResponseAt: graphDone - t0,
      rosterAt: t2 - t0,
      canvasReadyAt: t3 - t0,
      optionCount,
    },
    null,
    2,
  ),
);

await browser.close();
