/**
 * t74 重审 t44：布局体检探针。
 *
 * 背景：第一次跑 `zz-t44b-review.spec.ts` 时 `.graph-canvas` 的 boundingBox 是
 * 932×14626 —— 画布被拉到 1.4 万像素高，视口只有 900px。这会让「默认视野下
 * 节点逐点可分」这个可观察结果**无法在首屏看到**，也让按坐标点击的探针全部
 * 落到视口外（insideHits 0/8 就是这个原因，不是 nodePickingPadding 失效）。
 *
 * 本探针只量布局，不改任何东西：把画布、其祖先链、右侧清单、body 的高度与
 * 滚动尺寸全部 dump 出来，用于判断这是 t44 范围内的问题还是别人 WIP 的副作用。
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const READY = 90_000;
test.describe.configure({ timeout: 300_000 });

function outDir(): string {
  const root = process.env.PLAYWRIGHT_OUTPUT_DIR ?? '../../.scratch/pw-t44b-manual';
  const dir = path.resolve(process.cwd(), root, 't44b');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('t44b：/map 布局体检（画布为什么这么高）', async ({ page }) => {
  const dir = outDir();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/map', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.graph-canvas')).toBeVisible({ timeout: READY });
  await page.waitForTimeout(9_000);

  const report = await page.evaluate(() => {
    const chain: Array<Record<string, unknown>> = [];
    let el: HTMLElement | null = document.querySelector('.graph-canvas');
    while (el && chain.length < 10) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      chain.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 120),
        rectH: Math.round(r.height),
        rectW: Math.round(r.width),
        clientH: el.clientHeight,
        scrollH: el.scrollHeight,
        height: cs.height,
        minHeight: cs.minHeight,
        maxHeight: cs.maxHeight,
        display: cs.display,
        gridTemplateRows: cs.gridTemplateRows,
        gridTemplateColumns: cs.gridTemplateColumns,
        flex: cs.flex,
        overflow: cs.overflow,
        position: cs.position,
      });
      el = el.parentElement;
    }
    const roster = document.querySelector('.node-roster, [class*="roster"]') as HTMLElement | null;
    const rosterInfo = roster
      ? {
          cls: roster.className.toString().slice(0, 120),
          rectH: Math.round(roster.getBoundingClientRect().height),
          scrollH: roster.scrollHeight,
          clientH: roster.clientHeight,
          overflow: getComputedStyle(roster).overflowY,
          children: roster.querySelectorAll('*').length,
        }
      : null;
    const side = document.querySelector('aside, [class*="side"]') as HTMLElement | null;
    return {
      chain,
      roster: rosterInfo,
      side: side
        ? {
            cls: side.className.toString().slice(0, 120),
            rectH: Math.round(side.getBoundingClientRect().height),
            scrollH: side.scrollHeight,
          }
        : null,
      body: {
        scrollH: document.body.scrollHeight,
        clientH: document.body.clientHeight,
        scrollW: document.body.scrollWidth,
        clientW: document.body.clientWidth,
      },
      html: {
        scrollH: document.documentElement.scrollHeight,
        clientH: document.documentElement.clientHeight,
      },
      canvases: Array.from(document.querySelectorAll('canvas')).map((c) => ({
        w: c.width,
        h: c.height,
        cssW: Math.round(c.getBoundingClientRect().width),
        cssH: Math.round(c.getBoundingClientRect().height),
        parentCls: (c.parentElement?.className ?? '').toString().slice(0, 80),
      })),
    };
  });

  fs.writeFileSync(path.join(dir, 'layout-audit.json'), JSON.stringify(report, null, 2), 'utf8');
  // eslint-disable-next-line no-console
  console.log('layout-audit', JSON.stringify(report, null, 1).slice(0, 6000));

  await page.screenshot({ path: path.join(dir, 'fullpage.png'), fullPage: false });
  expect(report.canvases.length).toBeGreaterThan(0);
});
