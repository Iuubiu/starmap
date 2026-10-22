/**
 * 探针：/map 从 goto 到清单出现要多久；随后 getByRole('button', {name: STATE_LABEL})
 * 的第一个命中是图例还是清单项。用完即删。
 */
import { chromium } from '@playwright/test';

const STATE_LABEL = /未学习|刚接触|已熟悉|已熟练|已掌握/;

const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'zh-CN' });

for (let round = 0; round < 3; round += 1) {
  const t0 = Date.now();
  await page.goto('http://localhost:5173/map');
  await page.waitForSelector('.graph-roster-item', { timeout: 60_000 });
  const rosterMs = Date.now() - t0;
  const canvasCount = await page.locator('.graph-canvas').getAttribute('data-node-count');
  const rosterCount = await page.locator('.graph-roster-item').count();
  const first = page.getByRole('button', { name: STATE_LABEL }).first();
  const firstClass = await first.getAttribute('class');
  console.log(
    `round ${round}: roster visible after ${rosterMs}ms, canvas=${canvasCount}, roster=${rosterCount}, firstMatchClass=${firstClass}`,
  );
}

// 展开全部清单要多久
const t1 = Date.now();
const more = page.getByRole('button', { name: /继续显示/ });
if ((await more.count()) > 0) {
  await more.click();
  await page.waitForFunction(
    (n) => document.querySelectorAll('.graph-roster-item').length === n,
    Number(await page.locator('.graph-canvas').getAttribute('data-node-count')),
    { timeout: 60_000 },
  );
}
console.log(`expand all took ${Date.now() - t1}ms, roster=${await page.locator('.graph-roster-item').count()}`);

await browser.close();
