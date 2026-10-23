import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from '@playwright/test';

const OUT = resolve(process.cwd(), '../../.scratch/design-system-probe');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('profileDone', '1'); } catch { /* ignore */ }
  });
});

test('量正文块与右栏缝', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const rows: unknown[] = [];
  for (const width of [1280, 2566]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.waitForSelector('.sm-page-in', { timeout: 60_000 });
    await page.waitForTimeout(700);
    rows.push({
      width,
      ...(await page.evaluate(() => {
        const box = (el: Element | null) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), w: Math.round(r.width), right: Math.round(r.right) };
        };
        const main = document.getElementById('main')!;
        const root = document.querySelector('.sm-page-in')!.firstElementChild!;
        const stage = root.children[0] as HTMLElement;
        const side = root.children[1] as HTMLElement;
        // 正文：标题下的说明段 / 空态卡 / 输入条
        const paras = Array.from(document.querySelectorAll('p, [class*="fui-Text"]')).slice(0, 6);
        return {
          main: box(main),
          root: box(root),
          stage: box(stage),
          side: box(side),
          gapStageToSide: side && stage ? Math.round(side.getBoundingClientRect().left - stage.getBoundingClientRect().right) : null,
          card: box(document.querySelector('.fui-Card, [class*="fui-Card"]')),
          composer: box(document.querySelector('.sm-composer')),
          paragraphs: paras.map((p) => ({ text: (p.textContent ?? '').slice(0, 14), ...box(p) })),
        };
      })),
    });
  }
  writeFileSync(resolve(OUT, 'before2.json'), JSON.stringify(rows, null, 2));
});
