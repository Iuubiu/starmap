import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 375, height: 667 } });
await p.goto('http://localhost:5173/map');
await p.waitForTimeout(3000);
const info = await p.evaluate(() => {
  const out = [];
  for (const sel of ['.graph-canvas-webgl', '.graph-canvas', 'canvas', '.graph-canvas-host', '[data-node-count]']) {
    const els = [...document.querySelectorAll(sel)];
    out.push({ sel, n: els.length, sizes: els.slice(0,3).map(e => `${(e).offsetWidth}x${(e).offsetHeight}`) });
  }
  const main = document.querySelector('main');
  return { out, mainW: main?.offsetWidth, docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyText: (main?.innerText ?? '').slice(0, 300) };
});
console.log(JSON.stringify(info, null, 2));
await b.close();
