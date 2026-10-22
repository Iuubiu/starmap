/**
 * 探针：缩放按钮是否被别的元素挡住（hit target 检查）。用完即删。
 */
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'zh-CN' });
await page.goto('http://localhost:5173/map');
await page.waitForSelector('.graph-roster-item', { timeout: 90_000 });

for (const name of ['缩小图谱', '放大图谱', '复位图谱视野']) {
  const btn = page.getByRole('button', { name });
  const info = await btn.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return {
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      hitTag: hit ? hit.tagName : null,
      hitClass: hit && hit.className ? hit.className : null,
      hitIsSelf: hit === el || el.contains(hit),
      disabled: el.disabled,
    };
  });
  console.log(name, JSON.stringify(info));
}

const ratio = async () =>
  Number(await page.locator('.graph-canvas').getAttribute('data-camera-ratio'));
console.log('before', await ratio());
await page.getByRole('button', { name: '缩小图谱' }).click({ timeout: 8000 });
await page.waitForTimeout(600);
console.log('after out', await ratio());
await page.getByRole('button', { name: '放大图谱' }).click({ timeout: 8000 });
await page.waitForTimeout(600);
console.log('after in', await ratio());
await page.getByRole('button', { name: '复位图谱视野' }).click({ timeout: 8000 });
await page.waitForTimeout(800);
console.log('after reset', await ratio());

await browser.close();
