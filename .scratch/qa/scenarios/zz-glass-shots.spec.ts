import { test } from '@playwright/test';

/**
 * 液态玻璃外壳 · 视觉取证。
 *
 * 不是断言测试，是**取图**：captain 要肉眼判断「像不像液态玻璃」，所以每张
 * 图对应一个具体形态（轨道态 / 悬浮浮层 / 常驻展开 / 窄屏抽屉 / 明亮主题），
 * 而不是只截一张首页。
 *
 * 跑法（必须带 --output，否则并发时 trace 互删）：
 *   cd apps/web && npx playwright test --config=../../.scratch/qa/playwright.config.ts \
 *     zz-glass-shots --output=../../.scratch/pw-glass-<时间戳>
 */
const OUT = '../../.scratch/qa/shots';

/** 强制主题：headless chromium 的 prefers-color-scheme 是 light，
 *  不显式钉住的话「深色」那几张会拍到跟随系统后的明亮主题。 */
async function pinTheme(page: import('@playwright/test').Page, theme: 'dark' | 'light') {
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem('starmap.theme', value);
    } catch {
      /* ignore */
    }
  }, theme);
}

test.describe('液态玻璃外壳取图', () => {
  test('深色 · 首页（轨道态）', async ({ page }) => {
    await pinTheme(page, 'dark');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForSelector('nav[aria-label="主导航"]');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/glass-home-dark.png` });
  });

  test('深色 · 悬浮浮层（含名称与次级说明）', async ({ page }) => {
    await pinTheme(page, 'dark');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForSelector('nav[aria-label="主导航"]');
    await page.waitForTimeout(800);
    await page.locator('.sm-rail').hover();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/glass-flyout-dark.png` });
  });

  test('深色 · 常驻展开 260px', async ({ page }) => {
    await pinTheme(page, 'dark');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForSelector('nav[aria-label="主导航"]');
    await page.getByRole('button', { name: '固定展开导航' }).click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/glass-expanded-dark.png` });
  });

  test('深色 · 窄屏抽屉', async ({ page }) => {
    await pinTheme(page, 'dark');
    await page.setViewportSize({ width: 420, height: 800 });
    await page.goto('/');
    await page.getByRole('button', { name: '打开导航' }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/glass-drawer-dark.png` });
  });

  test('明亮 · 首页（轨道态）', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await pinTheme(page, 'light');
    await page.goto('/');
    await page.waitForSelector('nav[aria-label="主导航"]');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/glass-home-light.png` });
  });

  test('深色 · 看板（换页面看玻璃一致性）', async ({ page }) => {
    await pinTheme(page, 'dark');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/board');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/glass-board-dark.png` });
  });
});
