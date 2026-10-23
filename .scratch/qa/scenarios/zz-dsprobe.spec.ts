/**
 * 一次性探针：为 design-system 规范文件量「改前」现状。
 * 只读，只写 .scratch/design-system-probe/。用完即删。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from '@playwright/test';

const OUT = resolve(process.cwd(), '../../.scratch/design-system-probe');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('profileDone', '1'); } catch { /* ignore */ }
  });
});

test('量现状', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const rows: unknown[] = [];
  for (const width of [1280, 2566]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/learning']) {
      await page.goto(path);
      await page.waitForSelector('.sm-page-in', { timeout: 60_000 });
      await page.waitForTimeout(700);
      const m = await page.evaluate(() => {
        const main = document.getElementById('main');
        const root = document.querySelector('.sm-page-in')?.firstElementChild as HTMLElement | null;
        if (!main || !root) throw new Error('缺元素');
        const mr = main.getBoundingClientRect();
        const pr = root.getBoundingClientRect();
        const q = (s: string) => document.querySelector(s) as HTMLElement | null;
        const rect = (s: string) => {
          const el = q(s);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        };
        return {
          window: window.innerWidth,
          mainW: main.clientWidth,
          page: { left: Math.round(pr.left - mr.left), right: Math.round(mr.right - pr.right), w: Math.round(pr.width) },
          composer: rect('.sm-composer'),
          stage: rect('[data-stage], .sm-stage'),
          sidebar: rect('[data-study-sidebar], .sm-study-sidebar'),
          firstCard: rect('.sm-glass--card'),
          pageIn: rect('.sm-page-in'),
        };
      });
      rows.push({ width, path, ...m });
      await page.screenshot({ path: resolve(OUT, `before-${path === '/' ? 'home' : 'learning'}-${width}.png`), animations: 'disabled' });
    }
  }
  writeFileSync(resolve(OUT, 'before.json'), JSON.stringify(rows, null, 2));
});
