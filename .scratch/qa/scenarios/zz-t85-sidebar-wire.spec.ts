/**
 * t85 反向验证：右侧栏三个数字真的来自接口，不是写死的。
 *
 * 做法：拦 GET /api/v1/mastery/kp-bool，把 attemptCount/variantCount 改成
 * 2 / 1（一个真实学习者可能出现的早期状态），再断言界面跟着变。
 * 不修改任何源文件。
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

test('接口值变了，右侧栏跟着变（不是写死的）', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });

  await page.route('**/api/v1/mastery/kp-bool', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    body.attemptCount = 2;
    body.variantCount = 1;
    body.evidenceSufficient = false;
    body.state = 'attempted';
    await route.fulfill({ response, json: body });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?kp=kp-bool');
  await page.waitForSelector('[data-study-progress]');
  await page.waitForTimeout(1500);

  const rows: Record<string, string> = {};
  for (const label of ['作答', '变式', '连对']) {
    rows[label] = ((await page.locator(`[data-study-row="${label}"] .sm-study-row-value`).textContent()) ?? '').trim();
  }
  const suggestions = await page.locator('.sm-study-suggestion').allTextContents();
  writeFileSync(resolve(OUT, 'sidebar-intercepted.json'), `${JSON.stringify({ rows, suggestions }, null, 2)}\n`);

  expect(rows['作答']).toBe('2 / 8');
  expect(rows['变式']).toBe('1 / 3');
  expect(suggestions.some((text) => text.includes('还差 6 道题'))).toBe(true);
});
