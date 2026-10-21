/**
 * 探针：点缩放按钮期间主线程长任务与 ratio 变化。用完即删。
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
        w.__lt.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) });
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    /* ignore */
  }
});

await page.goto('http://localhost:5173/map');
await page.waitForSelector('.graph-roster-item', { timeout: 90_000 });
const t = () => Math.round(performance.now());

const ratio = async () =>
  Number(await page.locator('.graph-canvas').getAttribute('data-camera-ratio'));

for (let round = 1; round <= 3; round += 1) {
  const t0 = Date.now();
  await page.getByRole('button', { name: '缩小图谱' }).click({ timeout: 20000 });
  const t1 = Date.now();
  await page.waitForTimeout(300);
  const r1 = await ratio();
  await page.getByRole('button', { name: '放大图谱' }).click({ timeout: 20000 });
  const t2 = Date.now();
  await page.getByRole('button', { name: '复位图谱视野' }).click({ timeout: 20000 });
  const t3 = Date.now();
  await page.waitForTimeout(600);
  const r3 = await ratio();
  console.log(
    JSON.stringify({ round, clickOut: t1 - t0, clickIn: t2 - t1, clickReset: t3 - t2, r1, r3 }),
  );
}

const info = await page.evaluate(() => ({
  lt: window.__lt
    .slice()
    .sort((a, b) => b.dur - a.dur)
    .slice(0, 8),
  total: window.__lt.reduce((s, e) => s + e.dur, 0),
}));
console.log('longtasks', JSON.stringify(info));

await browser.close();
