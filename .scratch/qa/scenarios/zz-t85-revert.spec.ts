/**
 * t85 反向验证：把 t83 的外壳改动「还原」成票 76 的 760px 中列，
 * 确认 zz-layout-2560 依赖的度量真的会变（不是恒绿的空断言）。
 *
 * 做法：不改任何源文件，运行时注入一条 CSS 覆盖（等价于把
 * `.sm-page-in` 的 `grid-template-columns: minmax(0,1fr)` 改回
 * `1fr minmax(0,760px) 1fr`），再看 home@2560 的内容列宽。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const OUT = resolve(process.cwd(), '../../.scratch/qa/t85-review');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('profileDone', '1');
    } catch {
      /* ignore */
    }
  });
});

test('还原 760px 中列后，home@2560 内容列宽跌破 1000（t83 断言会红）', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 2560, height: 800 });
  await page.goto('/');
  await page.waitForSelector('[data-study-sidebar]');
  await page.waitForTimeout(500);

  const measure = () =>
    page.evaluate(() => {
      const main = document.getElementById('main')!;
      const root = document.querySelector('.sm-page-in')?.firstElementChild as HTMLElement;
      const mr = main.getBoundingClientRect();
      const pr = root.getBoundingClientRect();
      return {
        mainWidth: main.clientWidth,
        contentWidth: root.clientWidth,
        left: Math.round((pr.left - mr.left) * 100) / 100,
        right: Math.round((mr.right - pr.right) * 100) / 100,
      };
    });

  const before = await measure();
  await page.addStyleTag({
    content: '.sm-page-in{grid-template-columns:1fr minmax(0,760px) 1fr !important;}',
  });
  await page.waitForTimeout(300);
  const after = await measure();

  writeFileSync(
    resolve(OUT, 'revert.json'),
    `${JSON.stringify({ before, after }, null, 2)}\n`,
  );

  // 修复态：内容列 ≥ 1000（t83 的断言）
  expect(before.contentWidth).toBeGreaterThanOrEqual(1000);
  // 还原态：内容列被 760 卡住 → 该断言必然失败
  expect(after.contentWidth).toBeLessThan(1000);
});
