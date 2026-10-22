/**
 * 票 t47「窄视口下知识地图画布塌成 0」的取证场景（QA 侧）。
 *
 * 与 `apps/web/e2e/narrow.spec.ts` 的区别：那条是产品回归测试（7 档宽度 +
 * 可观察后果断言）；这一条是**验收取证** —— 逐档打印真实布局数值并落截图，
 * 供票面 Comments 直接引用。
 *
 * 缺陷回顾：`MapPage` 的栅格是 `minmax(0, 1fr) 340px`，右列固定 340px、左列
 * 允许缩到 0。视口 400px 时左列算出来是 `400 - 64(padding) - 16(gap) - 340 = -20`，
 * 被 `minmax(0, …)` 夹到 0 —— 画布容器宽度归零。sigma 的 `resize()` 在
 * `offsetWidth === 0` 时抛 `Sigma: Container has no width`，而它挂在 `window`
 * 的 resize 回调链上，落在 React 错误边界之外。
 *
 * 修复后应当看到：7 档宽度全部 outer > 0、webgl > 0，<=1080px 时清单落到
 * 画布下方（单列），pageerror 0 条。
 */
import { expect, test } from '@playwright/test';
import { attachDiagnostics, shot } from './_helpers';

const WIDTHS = [1440, 1080, 900, 600, 400, 375, 320] as const;
const NARROW_MAX = 1080;
const READY = 60_000;

test.describe.configure({ timeout: 180_000 });

test('七档视口宽度下的画布 / 清单 / 未捕获错误', async ({ page }) => {
  const diag = attachDiagnostics(page);

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/map', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.graph-canvas, .graph-canvas-broken', { timeout: READY });
    await page.waitForTimeout(1200);

    const measured = await page.evaluate(() => {
      const box = (selector: string) => {
        const el = document.querySelector(selector);
        return el ? Math.round(el.getBoundingClientRect().width) : -1;
      };
      const outer = document.querySelector('.graph-canvas, .graph-canvas-broken') as HTMLElement | null;
      const outerRect = outer ? outer.getBoundingClientRect() : null;
      const roster = document.querySelector('.graph-roster');
      return {
        outer: outerRect ? Math.round(outerRect.width) : -1,
        outerBottom: outerRect ? Math.round(outerRect.bottom) : -1,
        webgl: box('.graph-canvas-webgl'),
        roster: box('.graph-roster'),
        rosterTop: roster ? Math.round(roster.getBoundingClientRect().top) : -1,
        canvas: document.querySelectorAll('canvas.sigma-stage').length,
        blocked: document.querySelectorAll('.graph-canvas-blocked').length,
        items: document.querySelectorAll('.graph-roster-item').length,
      };
    });

    console.log(
      `width=${String(width).padStart(4)} -> webgl=${String(measured.webgl).padStart(4)} ` +
        `outer=${String(measured.outer).padStart(4)} canvas=${measured.canvas} ` +
        `blocked=${measured.blocked} roster=${String(measured.roster).padStart(4)} ` +
        `rosterTop=${String(measured.rosterTop).padStart(4)} items=${measured.items}`,
    );

    await shot(page, `zz-narrow-${width}`);

    expect(measured.outer, `width=${width}：画布宽度塌成 ${measured.outer}px`).toBeGreaterThan(0);
    expect(measured.roster, `width=${width}：清单宽度 ${measured.roster}px`).toBeGreaterThan(0);
    expect(measured.items, `width=${width}：清单条目为 0`).toBeGreaterThan(0);
    if (width <= NARROW_MAX) {
      expect(
        measured.rosterTop,
        `width=${width}：清单 top=${measured.rosterTop} 仍在画布 bottom=${measured.outerBottom} 之上`,
      ).toBeGreaterThanOrEqual(measured.outerBottom - 1);
    }
  }

  console.log(`pageerror 合计 ${diag.pageErrors.length} 条：${JSON.stringify(diag.pageErrors)}`);
  console.log(`consoleError 合计 ${diag.consoleErrors.length} 条：${JSON.stringify(diag.consoleErrors)}`);

  expect(
    diag.pageErrors.filter((m) => m.includes('Container has no width')),
    `仍有 sigma 的宽度异常：${JSON.stringify(diag.pageErrors)}`,
  ).toHaveLength(0);
  expect(diag.pageErrors, `出现未捕获错误：${JSON.stringify(diag.pageErrors)}`).toHaveLength(0);
  expect(diag.consoleErrors, `出现控制台错误：${JSON.stringify(diag.consoleErrors)}`).toHaveLength(0);
});
