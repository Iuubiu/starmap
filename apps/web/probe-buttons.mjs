/**
 * 探针：/map 上匹配五态词表的按钮到底是谁、点它为什么不导航。用完即删。
 */
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'zh-CN' });
await page.goto('http://localhost:5173/map');
await page.waitForSelector('.graph-roster-item', { timeout: 90_000 });

const items = await page
  .getByRole('button', { name: /未学习|刚接触|已熟悉|已熟练|已掌握/ })
  .evaluateAll((els) =>
    els.slice(0, 6).map((el) => ({
      tag: el.tagName,
      cls: el.className,
      label: el.getAttribute('aria-label'),
      text: (el.textContent ?? '').slice(0, 60),
      dataNode: el.getAttribute('data-node-id'),
      rect: el.getBoundingClientRect().toJSON(),
      pointerEvents: getComputedStyle(el).pointerEvents,
    })),
  );
console.log('matched', JSON.stringify(items, null, 2));
console.log(
  'total matched',
  await page.getByRole('button', { name: /未学习|刚接触|已熟悉|已熟练|已掌握/ }).count(),
);

await browser.close();
