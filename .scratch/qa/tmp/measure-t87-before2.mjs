/**
 * t87 规范文件的第二轮「改前」实测（只读）。
 *
 * 第一轮量到的是页面级盒子（内容列 / 右栏 / 留白 / Composer 位置）。这一轮补三件
 * 第一轮拿不到的东西，它们正是 captain 六条差距里 ③⑤⑥ 的直接证据：
 *   1. 最后一块内容底边到 Composer 顶边的垂直距离（⑥「与内容隔 500px」）；
 *   2. 关卡卡四格的实际背景色（⑤「深色小盒」—— 背景色是不是比卡片底更暗）；
 *   3. 右栏里几张卡的个数、间距、以及卡内有没有嵌套的小盒（③「互相挤压」）。
 *
 * 运行：cd apps/web && node ../../.scratch/qa/tmp/measure-t87-before2.mjs
 */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5173';
const WIDTHS = [
  { name: '1280', width: 1280, height: 800 },
  { name: '2566', width: 2566, height: 1080 },
];

const PROBE = () => {
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) };
  };
  const cs = (el, p) => (el ? getComputedStyle(el).getPropertyValue(p) : null);

  // ---- ⑥ Composer 与内容的垂直关系 ----
  const composer = document.querySelector('.sm-composer');
  const composerRect = r(composer);
  // 内容列 = Composer 的父级（页面里 Composer 与正文同列）
  let lastContentBottom = null;
  let contentGap = null;
  if (composer && composer.parentElement) {
    const siblings = [...composer.parentElement.children].filter((el) => el !== composer && el.getBoundingClientRect().height > 0);
    const last = siblings[siblings.length - 1];
    if (last) {
      lastContentBottom = Math.round(last.getBoundingClientRect().bottom);
      contentGap = composerRect ? composerRect.y - lastContentBottom : null;
    }
  }

  // ---- ⑤ 关卡卡四格：找一个 4 个等宽子元素的网格 ----
  const grids = [...document.querySelectorAll('div')].filter((el) => {
    if (el.children.length !== 4) return false;
    const kids = [...el.children];
    return kids.every((k) => k.children.length === 2); // label + value
  });
  const factGrid = grids[0] ?? null;
  const factCells = factGrid
    ? [...factGrid.children].map((el) => ({
        label: el.children[0]?.textContent?.trim(),
        value: el.children[1]?.textContent?.trim(),
        bg: cs(el, 'background-color'),
        radius: cs(el, 'border-radius'),
        padding: cs(el, 'padding'),
        rect: r(el),
        labelSize: cs(el.children[0], 'font-size'),
        labelColor: cs(el.children[0], 'color'),
        valueSize: cs(el.children[1], 'font-size'),
        valueWeight: cs(el.children[1], 'font-weight'),
      }))
    : [];

  // 四格所在的卡片（往上找带 .sm-glass 的祖先）
  let card = factGrid;
  while (card && !card.classList.contains('sm-glass')) card = card.parentElement;
  const cardBg = cs(card, 'background-color');

  // ---- ③ 右栏：卡片个数 / 间距 / 嵌套盒 ----
  const side = document.querySelector('[class*="side"]') ?? document.querySelector('.sm-study-sidebar');
  const sideChildren = side ? [...side.children].filter((el) => el.getBoundingClientRect().height > 0) : [];
  const sideGaps = [];
  for (let i = 1; i < sideChildren.length; i += 1) {
    sideGaps.push(Math.round(sideChildren[i].getBoundingClientRect().top - sideChildren[i - 1].getBoundingClientRect().bottom));
  }
  // 右栏里「自己带背景色」的后代（= 嵌套深色小盒）
  const nestedBoxes = side
    ? [...side.querySelectorAll('*')].filter((el) => {
        const bg = getComputedStyle(el).backgroundColor;
        if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') return false;
        return el.getBoundingClientRect().height > 8;
      }).length
    : null;

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    composer: composerRect,
    lastContentBottom,
    contentGap,
    factGrid: r(factGrid),
    cardBg,
    factCells,
    side: { rect: r(side), children: sideChildren.length, gaps: sideGaps, nestedBoxes },
  };
};

const browser = await chromium.launch();
const out = {};

for (const route of ['/', '/learning']) {
  for (const vp of WIDTHS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'zh-CN' });
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem('profileDone', '1');
      } catch {}
    });
    const page = await context.newPage();
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    await page.waitForSelector('.sm-page-in', { timeout: 15000 }).catch(() => {});
    if (route === '/') {
      const box = page.locator('.sm-composer-input');
      if (await box.count()) {
        await box.fill('我想学布尔代数的基本运算');
        await box.press('Enter');
        await page.waitForTimeout(6000);
      }
    }
    await page.waitForTimeout(500);
    out[`${route}@${vp.name}`] = await page.evaluate(PROBE);
    await page.screenshot({ path: `.scratch/qa/shots/t87-before-${route.replace('/', 'home') || 'home'}-${vp.name}.png`, fullPage: false });
    await context.close();
  }
}

await browser.close();
console.log(JSON.stringify(out, null, 2));
