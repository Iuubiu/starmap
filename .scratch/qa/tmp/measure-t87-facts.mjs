/**
 * t87 第四轮「改前」实测：关卡卡四格（⑤）与右栏结构（③）。
 *
 * 前三轮里「四格」的选择器误命中了 Composer 工具条上的胶囊（它们恰好也是
 * 4 个、每个 2 个子节点）。这一轮改成按**文字锚点**找：先找含「预计用时」的
 * 元素，再取它的父级作为一格，父级的父级就是四格网格。
 *
 * 运行：cd apps/web && node ../../.scratch/qa/tmp/measure-t87-facts.mjs
 */
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const out = {};

for (const vp of [{ width: 1280, height: 800 }, { width: 2566, height: 1080 }]) {
  const context = await browser.newContext({ viewport: vp, locale: 'zh-CN' });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem('profileDone', '1');
    } catch {}
  });
  const page = await context.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.sm-page-in', { timeout: 15000 }).catch(() => {});
  const box = page.locator('.sm-composer-input');
  if (await box.count()) {
    await box.fill('我想学布尔代数的基本运算');
    await box.press('Enter');
    await page.waitForTimeout(7000);
  }

  out[`home@${vp.width}`] = await page.evaluate(() => {
    const cs = (el, p) => (el ? getComputedStyle(el).getPropertyValue(p) : null);
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };

    // ---- ⑤ 四格：按文字锚点 ----
    const labelEl = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && (el.textContent || '').trim() === '预计用时');
    let cells = [];
    let gridRect = null;
    if (labelEl && labelEl.parentElement && labelEl.parentElement.parentElement) {
      const grid = labelEl.parentElement.parentElement;
      gridRect = r(grid);
      cells = [...grid.children].map((cell) => ({
        label: (cell.children[0]?.textContent || '').trim(),
        value: (cell.children[1]?.textContent || '').trim(),
        bg: cs(cell, 'background-color'),
        radius: cs(cell, 'border-radius'),
        padding: cs(cell, 'padding'),
        rect: r(cell),
        labelSize: cs(cell.children[0], 'font-size'),
        labelColor: cs(cell.children[0], 'color'),
        valueSize: cs(cell.children[1], 'font-size'),
        valueWeight: cs(cell.children[1], 'font-weight'),
        valueColor: cs(cell.children[1], 'color'),
      }));
    }
    // 四格所在卡片（往上找 backdrop-filter 不为 none 的祖先 = 玻璃卡）
    let card = labelEl;
    while (card && getComputedStyle(card).backdropFilter === 'none' && card !== document.body) card = card.parentElement;
    const cardBg = card && card !== document.body ? getComputedStyle(card).backgroundColor : null;

    // ---- ③ 右栏 ----
    const side = document.querySelector('.sm-side, [class*="side"]');
    let sideInfo = null;
    if (side) {
      const kids = [...side.children].filter((el) => el.getBoundingClientRect().height > 0);
      const gaps = [];
      for (let i = 1; i < kids.length; i += 1) {
        gaps.push(Math.round(kids[i].getBoundingClientRect().top - kids[i - 1].getBoundingClientRect().bottom));
      }
      const withBg = [...side.querySelectorAll('*')].filter((el) => {
        const bg = getComputedStyle(el).backgroundColor;
        return bg !== 'rgba(0, 0, 0, 0)' && el.getBoundingClientRect().height > 8;
      });
      sideInfo = {
        rect: r(side),
        children: kids.map((k) => ({ cls: String(k.className).slice(0, 40), rect: r(k) })),
        gaps,
        nestedBoxes: withBg.length,
        nestedSample: withBg.slice(0, 6).map((el) => ({ cls: String(el.className).slice(0, 36), bg: getComputedStyle(el).backgroundColor, rect: r(el) })),
      };
    }

    // ---- 正文列与右栏之间的水平缝 ----
    const stage = document.querySelector('.sm-stage, [class*="stage"]');
    const stageRect = stage ? r(stage) : null;
    const sideRect = side ? r(side) : null;
    const seam = stageRect && sideRect ? sideRect.x - (stageRect.x + stageRect.w) : null;

    // ---- 正文里最宽的文字块（正文气泡宽度） ----
    const bubbles = [...document.querySelectorAll('[class*="visibleResponse"], [class*="bubble"], [class*="assistant"]')]
      .map((el) => ({ cls: String(el.className).slice(0, 30), rect: r(el), text: (el.textContent || '').slice(0, 20) }))
      .filter((b) => b.rect.h > 20);

    return { viewport: { w: innerWidth, h: innerHeight }, gridRect, cardBg, cells, side: sideInfo, seam, bubbles };
  });

  await page.screenshot({ path: `.scratch/qa/shots/t87-before-facts-${vp.width}.png` });
  await context.close();
}

await browser.close();
console.log(JSON.stringify(out, null, 2));
