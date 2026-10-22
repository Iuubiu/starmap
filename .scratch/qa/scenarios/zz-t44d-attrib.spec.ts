/**
 * t74 重审 t44 — 探针 4：**画布 14626px 高的责任归属**（只读实验，不改任何源文件）。
 *
 * 用 `addStyleTag` 在页面里临时注入几条候选修复 CSS，看 `.graph-canvas` 高度是否回落。
 * 哪个能修好，就说明哪条链路是撑高的元凶 —— 全部在浏览器内存里，不碰工作区字节。
 *
 *   cd apps/web
 *   npx playwright test --config=../../.scratch/qa/playwright.config.ts \
 *     scenarios/zz-t44d-attrib.spec.ts --output=../../.scratch/pw-t44d-<ts>
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const READY = 90_000;
test.describe.configure({ timeout: 300_000 });

function outDir(): string {
  const root = process.env.PLAYWRIGHT_OUTPUT_DIR ?? '../../.scratch/pw-t44d-manual';
  const dir = path.resolve(process.cwd(), root, 't44d');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function boot(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/map', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.graph-canvas')).toBeVisible({ timeout: READY });
  await page.waitForTimeout(7_000);
}

async function measure(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const q = (s: string) => document.querySelector(s) as HTMLElement | null;
    const box = (el: HTMLElement | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        clientH: el.clientHeight,
        scrollH: el.scrollHeight,
        overflowY: getComputedStyle(el).overflowY,
        heightCss: getComputedStyle(el).height,
      };
    };
    return {
      canvas: box(q('.graph-canvas')),
      roster: box(q('.graph-roster')),
      pageIn: box(q('.sm-page-in')),
      main: box(q('main.sm-main')),
      stage: box(q('.sm-stage')),
      labels: q('.graph-canvas')?.getAttribute('data-labels-displayed') ?? null,
      nodes: q('.graph-canvas')?.getAttribute('data-node-count') ?? null,
    };
  });
}

const CANDIDATES: Array<{ name: string; css: string }> = [
  { name: 'baseline', css: '' },
  // 1) .sm-page-in 高度不定 → 给确定高度
  { name: 'fix-page-in-height', css: '.sm-page-in{height:100%;min-height:0;}' },
  // 2) 清单自身限高（证明 roster 内容高度是撑高源）
  { name: 'fix-roster-maxh', css: '.graph-roster{max-height:360px;}' },
  // 3) side 列限高
  { name: 'fix-side-maxh', css: '.graph-roster{max-height:360px;} .sm-page-in{height:100%;min-height:0;}' },
];

test('t44d：画布 14626px 的责任归属', async ({ page }) => {
  const dir = outDir();
  const results: Record<string, unknown> = {};
  for (const c of CANDIDATES) {
    await boot(page);
    if (c.css) {
      await page.addStyleTag({ content: c.css });
      await page.waitForTimeout(2_000);
    }
    const m = await measure(page);
    results[c.name] = m;
    if (c.name === 'fix-page-in-height') {
      const el = page.locator('.graph-canvas');
      await el.screenshot({ path: path.join(dir, 'fixed-canvas.png') });
      await page.screenshot({ path: path.join(dir, 'fixed-viewport.png') });
    }
  }
  fs.writeFileSync(path.join(dir, 'attrib.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log('WROTE', dir, JSON.stringify(results, null, 1));
  expect(results.baseline).toBeTruthy();
});
