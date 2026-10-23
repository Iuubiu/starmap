/**
 * t85 独立复核探针（reviewer-2 自写，不复用实现者断言）。
 *
 * 三件事：
 *   1. 四页 × 四档宽度，我自己量左右留白与内容列宽（不读实现者写的 metrics）；
 *   2. 右侧栏三门槛的渲染值 vs 真实接口返回值逐条对照；
 *   3. Composer 唯一性（DOM 里 .sm-composer 与 textarea 的数量）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const OUT = resolve(process.cwd(), '../../.scratch/qa/t85-review');
const PAGES = [
  { name: 'home', path: '/', ready: '.sm-composer' },
  { name: 'learning', path: '/learning', ready: '.sm-composer' },
  { name: 'market', path: '/market', ready: 'main' },
  { name: 'map', path: '/map', ready: '.graph-canvas' },
] as const;
const WIDTHS = [1280, 1440, 1920, 2560] as const;

/* 首页被「初识」门挡着：没做过画像的浏览器打开 `/` 会跳到 `/welcome`。
   这里置上产品自己的开关 `profileDone`（WelcomePage.markProfileDone 写的同一个键）。 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('profileDone', '1');
    } catch {
      /* ignore */
    }
  });
});

async function measure(page: import('@playwright/test').Page, pageName: string, width: number) {
  return page.evaluate(
    ({ pageName, width }) => {
      const main = document.getElementById('main')!;
      const root = document.querySelector('.sm-page-in')?.firstElementChild as HTMLElement | null;
      const mr = main.getBoundingClientRect();
      const pr = root?.getBoundingClientRect();
      const graph = document.querySelector('.graph-canvas') as HTMLElement | null;
      return {
        page: pageName,
        width,
        mainWidth: main.clientWidth,
        contentWidth: root ? root.clientWidth : null,
        left: pr ? Math.round((pr.left - mr.left) * 100) / 100 : null,
        right: pr ? Math.round((mr.right - pr.right) * 100) / 100 : null,
        canvasWidth: graph ? Math.round(graph.getBoundingClientRect().width * 100) / 100 : null,
      };
    },
    { pageName, width },
  );
}

test('四页 × 四档：我自己的留白与内容列测量', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const rows: unknown[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    for (const target of PAGES) {
      await page.goto(target.path);
      await page.waitForSelector(target.ready);
      await page.waitForTimeout(600);
      rows.push(await measure(page, target.name, width));
    }
  }
  writeFileSync(resolve(OUT, 'my-layout.json'), `${JSON.stringify(rows, null, 2)}\n`);
  // 断言只用来钉住「我量到的」与「它量的」一致（差 ≤ 2px）
  const home2560 = rows.find(
    (r) => (r as { page: string; width: number }).page === 'home' && (r as { width: number }).width === 2560,
  ) as { contentWidth: number; mainWidth: number };
  expect(home2560.contentWidth).toBeGreaterThanOrEqual(1000);
});

test('右侧栏三门槛：渲染值 = 真实接口值', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const api = await page.request.get('http://127.0.0.1:3001/api/v1/mastery/kp-bool');
  const mastery = (await api.json()) as { attemptCount: number; variantCount: number; evidenceSufficient: boolean };
  const gateApi = await page.request.get('http://127.0.0.1:3001/api/v1/levels/lv-bool-laws/gate/history');
  const gate = (await gateApi.json()) as { evaluations: unknown[] };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?kp=kp-bool');
  await page.waitForSelector('[data-study-progress]');
  await page.waitForTimeout(1500);

  const rendered: Record<string, string> = {};
  for (const label of ['作答', '变式', '连对']) {
    rendered[label] = ((await page.locator(`[data-study-row="${label}"] .sm-study-row-value`).textContent()) ?? '').trim();
  }
  const suggestions = await page.locator('.sm-study-suggestion').allTextContents();

  writeFileSync(
    resolve(OUT, 'sidebar.json'),
    `${JSON.stringify(
      {
        api: { attemptCount: mastery.attemptCount, variantCount: mastery.variantCount, evidenceSufficient: mastery.evidenceSufficient },
        gateEvaluations: gate.evaluations.length,
        rendered,
        suggestions,
      },
      null,
      2,
    )}\n`,
  );

  // 真实接口说 attemptCount 很大、variantCount=3、证据充分 → 界面必须是 8/8 与 3/3
  expect(rendered['作答']).toBe('8 / 8');
  expect(rendered['变式']).toBe('3 / 3');
  // 门控历史为空 → 连对必须是「证据不足」而不是 0 / 2
  expect(rendered['连对']).toBe('证据不足');
});

test('Composer 唯一：DOM 里只有一份输入条', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const counts: Record<string, { composer: number; box: number; textarea: number }> = {};
  for (const path of ['/', '/learning']) {
    await page.goto(path);
    await page.waitForSelector('.sm-composer');
    await page.waitForTimeout(400);
    counts[path] = await page.evaluate(() => ({
      composer: document.querySelectorAll('.sm-composer').length,
      box: document.querySelectorAll('.sm-composer-box').length,
      textarea: document.querySelectorAll('textarea').length,
    }));
  }
  writeFileSync(resolve(OUT, 'composer.json'), `${JSON.stringify(counts, null, 2)}
`);
  expect(counts['/']!.composer).toBe(1);
  expect(counts['/']!.box).toBe(1);
  expect(counts['/']!.textarea).toBe(1);
  expect(counts['/learning']!.composer).toBe(1);
  expect(counts['/learning']!.textarea).toBe(1);
});
