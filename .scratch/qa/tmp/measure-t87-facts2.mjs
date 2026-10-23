/**
 * t87 第五轮「改前」实测：把**关卡卡四格**量下来（captain 差距 ⑤ 的唯一硬证据）。
 *
 * 前一轮没量到，是因为那一轮模型产出的是一张「问津」追问卡（`probe_form`），
 * 卡上没有四格。四格只出现在 `level_card` 上（`ArtifactCard.tsx:317`）。这一轮
 * 带重试：没出关卡卡就点「再试一次」，最多 4 次。
 *
 * 运行：cd apps/web && node ../../.scratch/qa/tmp/measure-t87-facts2.mjs
 */
import { chromium } from '@playwright/test';

const UTTERANCE = '我想学布尔代数的基本运算';

const browser = await chromium.launch();
const out = {};

for (const vp of [{ width: 1280, height: 800 }, { width: 2566, height: 1080 }]) {
  const context = await browser.newContext({ viewport: vp, locale: 'zh-CN', colorScheme: 'dark' });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem('profileDone', '1');
      window.localStorage.setItem('starmap.theme', 'dark');
    } catch {}
  });
  const page = await context.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.sm-page-in', { timeout: 20000 }).catch(() => {});

  let gotIt = false;
  for (let attempt = 0; attempt < 4 && !gotIt; attempt += 1) {
    if (attempt === 0) {
      const box = page.locator('.sm-composer-input');
      if (await box.count()) {
        await box.fill(UTTERANCE);
        await box.press('Enter');
      }
    } else {
      const retry = page.getByRole('button', { name: '再试一次' });
      if (await retry.count()) await retry.click();
      else {
        const box = page.locator('.sm-composer-input');
        if (await box.count()) {
          await box.fill(UTTERANCE);
          await box.press('Enter');
        }
      }
    }
    await page.waitForTimeout(9000);
    gotIt = (await page.locator('text=预计用时').count()) > 0;
  }

  out[`home@${vp.width}`] = {
    gotLevelCard: gotIt,
    ...(await page.evaluate(() => {
      const cs = (el, p) => (el ? getComputedStyle(el).getPropertyValue(p) : null);
      const r = (el) => {
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
      };
      const labelEl = [...document.querySelectorAll('*')].find(
        (el) => el.children.length === 0 && (el.textContent || '').trim() === '预计用时',
      );
      if (!labelEl) return { cells: [], grid: null, cardBg: null, composer: r(document.querySelector('.sm-composer')) };

      const grid = labelEl.parentElement.parentElement;
      const cells = [...grid.children].map((cell) => ({
        label: (cell.children[0]?.textContent || '').trim(),
        value: (cell.children[1]?.textContent || '').trim(),
        bg: cs(cell, 'background-color'),
        radius: cs(cell, 'border-radius'),
        padding: cs(cell, 'padding'),
        gap: cs(cell, 'gap'),
        rect: r(cell),
        labelSize: cs(cell.children[0], 'font-size'),
        labelColor: cs(cell.children[0], 'color'),
        valueSize: cs(cell.children[1], 'font-size'),
        valueWeight: cs(cell.children[1], 'font-weight'),
        valueColor: cs(cell.children[1], 'color'),
      }));

      // 卡片：从四格往上找第一个有 backdrop-filter 的祖先
      let card = grid;
      while (card && getComputedStyle(card).backdropFilter === 'none' && card !== document.body) card = card.parentElement;
      const cardBg = card && card !== document.body ? getComputedStyle(card).backgroundColor : null;

      // 卡片底边 → Composer 顶边
      const composer = document.querySelector('.sm-composer');
      const cardRect = card && card !== document.body ? r(card) : null;
      const composerRect = composer ? r(composer) : null;

      return {
        grid: r(grid),
        gridGap: cs(grid, 'gap'),
        cardBg,
        cardRect,
        cells,
        composer: composerRect,
        cardToComposer: cardRect && composerRect ? composerRect.y - (cardRect.y + cardRect.h) : null,
      };
    })),
  };

  await page.screenshot({ path: `.scratch/qa/shots/t87-before-levelcard-${vp.width}.png` });
  await context.close();
}

await browser.close();
console.log(JSON.stringify(out, null, 2));
