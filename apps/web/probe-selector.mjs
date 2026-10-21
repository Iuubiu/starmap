/**
 * 探针：`getByRole('button', {name: /未学习|刚接触|已熟悉|已熟练|已掌握/})` 到底
 * 命中哪些元素、DOM 顺序里第一个是谁。用完即删。
 */
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'zh-CN' });
await page.goto('http://localhost:5173/map');
await page.waitForSelector('.graph-roster-item', { timeout: 60_000 });

const info = await page.evaluate(() => {
  const re = /未学习|刚接触|已熟悉|已熟练|已掌握/;
  const buttons = Array.from(document.querySelectorAll('button'));
  const matched = buttons
    .map((b, i) => ({
      i,
      cls: b.className,
      aria: b.getAttribute('aria-label'),
      text: (b.textContent ?? '').trim().slice(0, 40),
      // 简化版可访问名：aria-label 优先，否则 textContent
      name: (b.getAttribute('aria-label') ?? b.textContent ?? '').trim(),
    }))
    .filter((b) => re.test(b.name));
  return {
    totalButtons: buttons.length,
    rosterCount: document.querySelectorAll('.graph-roster-item').length,
    firstFive: matched.slice(0, 5),
    matchedCount: matched.length,
  };
});

console.log(JSON.stringify(info, null, 2));
await browser.close();
