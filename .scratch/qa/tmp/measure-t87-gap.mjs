/**
 * t87 第三轮「改前」实测：只补一个数 —— 正文最后一块内容与 Composer 顶边的垂直距离。
 *
 * 前两轮已经把内容列 / 右栏 / 留白 / 四格量到了，唯独这条要按「Composer 的父级
 * 里、位于它之前的最后一个有高度的兄弟」来算，而首页的 Composer 是 sticky 的，
 * `getBoundingClientRect` 给的是它**当前粘住的位置**，不是文档流位置 —— 所以必须
 * 把 `main` 滚到最底再量，否则量到的是「还没滚到底时」的间隙。
 *
 * 运行：cd apps/web && node ../../.scratch/qa/tmp/measure-t87-gap.mjs
 */
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const out = {};

for (const [route, vp] of [
  ['/', { width: 1280, height: 800 }],
  ['/', { width: 2566, height: 1080 }],
  ['/learning', { width: 1280, height: 800 }],
  ['/learning', { width: 2566, height: 1080 }],
]) {
  const context = await browser.newContext({ viewport: vp, locale: 'zh-CN' });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem('profileDone', '1');
    } catch {}
  });
  const page = await context.newPage();
  await page.goto('http://localhost:5173' + route, { waitUntil: 'networkidle' });
  await page.waitForSelector('.sm-page-in', { timeout: 15000 }).catch(() => {});
  if (route === '/') {
    const box = page.locator('.sm-composer-input');
    if (await box.count()) {
      await box.fill('我想学布尔代数的基本运算');
      await box.press('Enter');
      await page.waitForTimeout(6000);
    }
  }
  // 滚到底：sticky 元素只有在滚动终点才贴在它该在的位置
  await page.evaluate(() => {
    const main = document.querySelector('.sm-main');
    if (main) main.scrollTop = main.scrollHeight;
  });
  await page.waitForTimeout(400);

  out[`${route}@${vp.width}`] = await page.evaluate(() => {
    const composer = document.querySelector('.sm-composer');
    if (!composer) return null;
    const cRect = composer.getBoundingClientRect();
    // Composer 的**列容器**：往上找到第一个 display:grid/flex 且含 Composer 的祖先
    let column = composer.parentElement;
    const siblings = column ? [...column.children].filter((el) => el !== composer && el.getBoundingClientRect().height > 0) : [];
    const last = siblings[siblings.length - 1];
    const lastRect = last ? last.getBoundingClientRect() : null;
    return {
      composerTop: Math.round(cRect.top),
      composerWidth: Math.round(cRect.width),
      composerBottomGap: Math.round(window.innerHeight - cRect.bottom),
      columnChildren: column ? column.children.length : null,
      lastSibling: last ? { tag: last.tagName, cls: String(last.className).slice(0, 40), bottom: lastRect ? Math.round(lastRect.bottom) : null } : null,
      contentToComposerGap: lastRect ? Math.round(cRect.top - lastRect.bottom) : null,
    };
  });
  await context.close();
}

await browser.close();
console.log(JSON.stringify(out, null, 2));
