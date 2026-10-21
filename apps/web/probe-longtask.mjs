/**
 * 探针：/map 首屏主线程长任务分布。用完即删。
 * 用 addInitScript 在页面脚本之前挂 PerformanceObserver，抓所有 >50ms 的 longtask。
 */
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'zh-CN' });

await page.addInitScript(() => {
  const w = window;
  w.__lt = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        w.__lt.push({
          start: Math.round(e.startTime),
          dur: Math.round(e.duration),
          name: e.name,
        });
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    /* ignore */
  }
  // 记录 network 结束时刻
  w.__graphDone = 0;
  const origFetch = w.fetch;
  w.fetch = async (...args) => {
    const res = await origFetch(...args);
    const url = String(args[0]);
    if (url.includes('/api/v1/graph')) w.__graphDone = Math.round(performance.now());
    return res;
  };
});

const t0 = Date.now();
await page.goto('http://localhost:5173/map');
await page.waitForSelector('.graph-roster-item', { timeout: 90_000 });
const rosterAt = Date.now() - t0;

const info = await page.evaluate(() => ({
  graphDone: window.__graphDone,
  lt: window.__lt.slice().sort((a, b) => b.dur - a.dur).slice(0, 12),
  totalLt: window.__lt.reduce((s, e) => s + e.dur, 0),
  count: window.__lt.length,
}));

console.log(JSON.stringify({ rosterAt, ...info }, null, 2));
await browser.close();
