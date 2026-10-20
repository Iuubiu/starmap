import { chromium } from '@playwright/test';

const pages = [
  ['database', 'http://localhost:5173/database'],
  ['dashboard', 'http://localhost:5173/'],
  ['map', 'http://localhost:5173/map'],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

for (const [name, url] of pages) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `.scratch/shot-db-${name}.png`, fullPage: false });
  console.log(`shot: ${name}`);
}

console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
