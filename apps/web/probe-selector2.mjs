/**
 * 探针：Playwright 的 getByRole('button', {name: STATE_LABEL}) 到底命中几个、
 * 第一个的类名和可访问名是什么。用完即删。
 */
import { chromium } from '@playwright/test';

const STATE_LABEL = /未学习|刚接触|已熟悉|已熟练|已掌握/;

const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'zh-CN' });
await page.goto('http://localhost:5173/map');
await page.waitForSelector('.graph-roster-item', { timeout: 60_000 });

const loc = page.getByRole('button', { name: STATE_LABEL });
const count = await loc.count();
const first = loc.first();
console.log('count =', count);
console.log('first class =', await first.getAttribute('class'));
console.log('first aria-label =', await first.getAttribute('aria-label'));
console.log('first title =', await first.getAttribute('title'));
console.log('first text =', JSON.stringify((await first.textContent())?.trim()));

// 图例按钮自身的可访问名（Playwright 视角）
const legend = page.locator('.graph-legend-item').first();
console.log('legend count =', await page.locator('.graph-legend-item').count());
for (let i = 0; i < 4; i++) {
  const el = page.locator('.graph-legend-item').nth(i);
  console.log(
    `legend[${i}]`,
    'aria-snapshot =',
    JSON.stringify(await el.getAttribute('data-status')),
    '| matches regex?',
    await el.evaluate((node, src) => new RegExp(src).test(node.textContent ?? ''), STATE_LABEL.source),
  );
}
console.log('getByRole count for /已掌握/:', await page.getByRole('button', { name: /已掌握/ }).count());

await browser.close();
