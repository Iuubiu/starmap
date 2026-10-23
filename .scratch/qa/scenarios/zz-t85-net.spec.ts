/**
 * t85 复核探针 2：证明右侧栏三项**确实发了请求**（不是前端编的数字）。
 * 做法：拦 /api/v1/ 的响应，记录右侧栏依赖的三条接口是否被调用、
 * 返回值是什么，再与 DOM 上的数字比对。
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

test('右侧栏三条数据都来自真实 HTTP（不是前端常量）', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const seen: Array<{ url: string; status: number; body: unknown }> = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('/api/v1/')) return;
    if (!/(mastery|unlock|gate)/.test(url)) return;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = '<non-json>';
    }
    seen.push({ url, status: res.status(), body });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?kp=kp-bool');
  await page.waitForSelector('[data-study-progress]');
  await page.waitForTimeout(2000);

  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-study-row]')).map((el) => ({
      label: el.getAttribute('data-study-row'),
      value: el.querySelector('.sm-study-row-value')?.textContent ?? '',
    })),
  );

  writeFileSync(resolve(OUT, 'net.json'), `${JSON.stringify({ seen, rows }, null, 2)}\n`);

  const masteryCall = seen.find((s) => s.url.includes('/mastery/'));
  const unlockCall = seen.find((s) => s.url.includes('/unlock'));
  const gateCall = seen.find((s) => s.url.includes('/gate/'));

  expect(masteryCall, '必须请求过 /mastery/:id').toBeTruthy();
  expect(unlockCall, '必须请求过 /nodes/:id/unlock').toBeTruthy();
  expect(gateCall, '必须请求过 /levels/:id/gate/history').toBeTruthy();

  const m = masteryCall!.body as any;
  expect(rows.find((r) => r.label === '作答')?.value).toContain(`${m.attemptCount} / 8`);
  expect(rows.find((r) => r.label === '变式')?.value).toContain(`${m.variantCount} / 3`);
});
