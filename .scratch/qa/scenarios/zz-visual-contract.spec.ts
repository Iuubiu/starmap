import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

/**
 * 视觉契约：形状必须能被量出来，而不是「看起来圆了」。
 *
 * 数字来源（不自己拍）：
 *   raycast.com 生产 CSS 实测（6 个 chunk，389 KB）
 *   12px → .qDZGta_popover / .YrhMfW_announcement / .wHs0Qq_focusBar
 *   10px → .ppYp9a_cardWrapper / .YkiDJG_extensionCard / .f0hM2W_callToAction
 *    6px → .IS8qgq_searchItem / .wHs0Qq_timer（小控件）
 * 所以：卡片 12、按钮与输入 10、小 chip 允许 6 或全圆。
 *
 * 深色主题的层次感另有一条：Raycast 的卡片不是靠描边立起来的，是靠
 * 「顶部 1px 内发光」。没有 box-shadow 的深色卡片会退化成一块平板。
 */

const ROUTES = [
  { name: 'home', path: '/' },
  { name: 'board', path: '/board' },
  { name: 'level', path: '/level/lv-bool-laws' },
] as const;

type Surface = {
  radius: number;
  w: number;
  h: number;
  tag: string;
  shadow: string;
  text: string;
};

async function collect(page: import('@playwright/test').Page): Promise<Surface[]> {
  return page.evaluate(() => {
    const out: Array<{ radius: number; w: number; h: number; tag: string; shadow: string; text: string }> = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 24) continue;
      // 整页容器（shell / main / 满屏 div）不是「卡片」，否则 0px 会把数字带偏
      if (r.width >= 1000 && r.height >= 700) continue;
      const hasSurface =
        cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
        parseFloat(cs.borderTopWidth) > 0 ||
        cs.boxShadow !== 'none';
      if (!hasSurface) continue;
      out.push({
        radius: parseFloat(cs.borderTopLeftRadius) || 0,
        w: Math.round(r.width),
        h: Math.round(r.height),
        tag: el.tagName.toLowerCase(),
        shadow: cs.boxShadow,
        text: (el.textContent ?? '').trim().slice(0, 20),
      });
    }
    return out;
  });
}

for (const mode of ['light', 'dark'] as const) {
  test(`视觉契约 · ${mode}`, async ({ page }) => {
    await page.addInitScript((m) => {
      window.localStorage.setItem('starmap.theme', m);
    }, mode);

    const report: Record<string, unknown> = {};

    for (const route of ROUTES) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1800);
      await page.screenshot({ path: `.scratch/qa/shots/vc-${route.name}-${mode}.png` });

      const surfaces = await collect(page);

      // 卡片：宽 ≥ 300 且高 ≥ 80 的有表面元素
      const cards = surfaces.filter((s) => s.w >= 300 && s.h >= 80);
      const buttons = surfaces.filter((s) => s.tag === 'button' || s.tag === 'input');

      report[route.name] = {
        surfaces: surfaces.length,
        cards: cards.map((c) => ({ w: c.w, h: c.h, radius: c.radius, text: c.text })),
        buttonRadius: [...new Set(buttons.map((b) => b.radius))].sort((a, b) => a - b),
        thinCards: cards.filter((c) => c.radius < 12).length,
        thinButtons: buttons.filter((b) => b.radius < 10).length,
        darkCardsWithoutShadow:
          mode === 'dark' ? cards.filter((c) => c.shadow === 'none').length : null,
      };
    }

    writeFileSync(`.scratch/qa/shots/visual-contract-${mode}.json`, JSON.stringify(report, null, 2), 'utf8');
    console.log(`VC_${mode.toUpperCase()} ` + JSON.stringify(report));

    // 断言：卡片 12px 以上、按钮 10px 以上
    for (const route of ROUTES) {
      const r = report[route.name] as { cards: Array<{ radius: number; w: number; h: number; text: string }> };
      const bad = r.cards.filter((c) => c.radius < 12);
      expect(
        bad,
        `${route.name}:${mode} 有 ${bad.length} 张卡片圆角 < 12px（Raycast 卡片是 10–12px）: ` +
          bad.map((c) => `${c.w}x${c.h}@${c.radius}px「${c.text}」`).join(' | '),
      ).toEqual([]);
    }
  });
}
