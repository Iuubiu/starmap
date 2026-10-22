/**
 * 探针：/map 首屏那个 3.4s 长任务的 CPU profile 归因。用完即删。
 * 只 profile 到清单出现为止，按 (functionName, url) 聚合 self time。
 */
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'zh-CN' });
const cdp = await page.context().newCDPSession(page);

await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });

await page.goto('http://localhost:5173/map');
await cdp.send('Profiler.start');
await page.waitForSelector('.graph-roster-item', { timeout: 90_000 });
const { profile } = await cdp.send('Profiler.stop');

const byId = new Map();
for (const n of profile.nodes) byId.set(n.id, n);

const selfTime = new Map();
const total = profile.samples.length;
for (const id of profile.samples) {
  const n = byId.get(id);
  if (!n) continue;
  const cf = n.callFrame;
  const url = (cf.url || '').replace('http://localhost:5173', '');
  const key = `${cf.functionName || '(anonymous)'} @ ${url}:${cf.lineNumber + 1}`;
  selfTime.set(key, (selfTime.get(key) ?? 0) + 1);
}

const top = [...selfTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
console.log('samples', total);
for (const [key, n] of top) {
  console.log(`${((n / total) * 100).toFixed(1).padStart(5)}%  ${key}`);
}

await browser.close();
