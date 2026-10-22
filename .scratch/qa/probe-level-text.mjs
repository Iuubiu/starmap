import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:5173/level/lv-bool-laws', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
console.log('LEN', text.length);
console.log(text.slice(0, 1200));
await page.screenshot({ path: '.scratch/qa/shots/level-direct.png', fullPage: false });
await browser.close();
