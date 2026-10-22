/**
 * 复现 03-twenty 场景 20 的 settled 超时：刷新后是否残留「不确定态 progressbar」。
 *
 * 目的：判定这是「产品在刷新后卡在 loading」还是「settled 判据把某个常驻进度条算成 loading」。
 * 输出每一轮之后仍存在的 progressbar 明细（aria-valuenow / aria-label / 所在容器文本）。
 */
import { chromium } from '@playwright/test';

const WEB = 'http://localhost:5173';

const dump = async (page, tag) => {
  const rows = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[role="progressbar"]')) {
      out.push({
        valuenow: el.getAttribute('aria-valuenow'),
        label: el.getAttribute('aria-label'),
        parentText: (el.closest('[class]')?.parentElement?.innerText ?? '').slice(0, 90).replace(/\s+/g, ' '),
      });
    }
    return out;
  });
  const indeterminate = rows.filter((r) => r.valuenow === null);
  console.log(`\n[${tag}] progressbar total=${rows.length} indeterminate=${indeterminate.length}`);
  for (const r of rows) {
    console.log(`   valuenow=${r.valuenow === null ? 'NULL' : r.valuenow} label=${r.label} | ${r.parentText}`);
  }
  return indeterminate.length;
};

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.log('   console.error:', m.text().slice(0, 200));
});

await page.goto(WEB + '/');
await page.waitForTimeout(3000);
await dump(page, '1 首次进入');

const box = page.getByLabel('这一轮想说的话');
await box.fill('刷新保持测试');
await box.press('Enter');
await page.waitForTimeout(2000);
await dump(page, '2 提交后 2s');

// 轮询到 30s，看是否真的永远不消失
for (const t of [5, 10, 20, 30]) {
  await page.waitForTimeout(t * 1000 - (t === 5 ? 0 : 0));
  const n = await dump(page, `3 提交后累计 ~${t}s`);
  if (n === 0) break;
}

await page.reload();
await page.waitForTimeout(3000);
await dump(page, '4 刷新后 3s');
for (const t of [5, 10, 20, 30]) {
  await page.waitForTimeout(5000);
  const n = await dump(page, `5 刷新后累计 ~${3 + t}s`);
  if (n === 0) break;
}

const mainText = await page.getByRole('main').innerText();
console.log('\n[main 文本前 400 字]\n' + mainText.slice(0, 400).replace(/\s+/g, ' '));
console.log('\n[是否包含「刷新保持测试」]', mainText.includes('刷新保持测试'));

await browser.close();
