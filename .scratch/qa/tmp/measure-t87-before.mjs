/**
 * t87 规范文件的「改前」实测脚本（只读：不写任何 apps/ 下的文件）。
 *
 * 目的：captain 给的六条差距是他/authoring-dev 口头量出的数字，规范文件里
 * 要写「改前 → 改后」，所以先自己量一遍，避免把别人的估算抄成事实。
 *
 * 量什么：
 *   1. 学习页 / 首页在 1280 与 2566 下的内容列宽、左右留白、右栏宽、栏间距；
 *   2. Composer 的位置、宽度、与最后一条内容的垂直间距；
 *   3. 关卡卡四格（Fact）的实际背景色（判断是不是「深色小盒」）；
 *   4. 侧栏进度条轨道/填充色。
 *
 * 运行：node .scratch/qa/tmp/measure-t87-before.mjs
 */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5173';
const WIDTHS = [
  { name: '1280', width: 1280, height: 800 },
  { name: '2566', width: 2566, height: 1080 },
];

/** 在页面里量一组盒模型事实。 */
const PROBE = () => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const cs = (el, prop) => (el ? getComputedStyle(el).getPropertyValue(prop) : null);

  const main = document.querySelector('.sm-main');
  const pageIn = document.querySelector('.sm-page-in');
  const page = pageIn ? pageIn.firstElementChild : null;

  // 内容列 = 页面根元素；正文字宽用最长的那段正文估
  const paragraphs = [...document.querySelectorAll('p, [class*="visibleResponse"], [class*="stem"]')];
  const widestText = paragraphs.reduce((best, el) => {
    const r = el.getBoundingClientRect();
    const text = (el.textContent || '').trim();
    return text.length > 40 && r.width > (best?.w ?? 0) ? { w: Math.round(r.width), tag: el.tagName } : best;
  }, null);

  const grid = page ? getComputedStyle(page) : null;
  const cols = grid ? grid.gridTemplateColumns : null;
  const pageRect = rect(page);
  const mainRect = rect(main);

  const composer = document.querySelector('.sm-composer');
  const composerBox = document.querySelector('.sm-composer-box');

  // 关卡卡四格
  const factCells = [...document.querySelectorAll('[class*="fact"]')]
    .filter((el) => el.children.length === 2)
    .slice(0, 6)
    .map((el) => ({
      text: (el.textContent || '').slice(0, 24),
      background: cs(el, 'background-color'),
      borderRadius: cs(el, 'border-radius'),
      padding: cs(el, 'padding'),
      rect: rect(el),
    }));

  // 进度条
  const track = document.querySelector('.sm-study-track');
  const fill = document.querySelector('.sm-study-fill');

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    main: mainRect,
    page: pageRect,
    pageColumns: cols,
    pageGap: grid ? grid.gap : null,
    pageMaxWidth: grid ? grid.maxWidth : null,
    pagePadding: grid ? grid.padding : null,
    gutters: pageRect && mainRect ? { left: pageRect.x - mainRect.x, right: mainRect.x + mainRect.w - (pageRect.x + pageRect.w) } : null,
    widestText,
    composer: rect(composer),
    composerBox: rect(composerBox),
    composerBottom: composer ? Math.round(window.innerHeight - composer.getBoundingClientRect().bottom) : null,
    factCells,
    progress: { track: cs(track, 'background-color'), fill: cs(fill, 'background-color'), fillWidth: rect(fill)?.w ?? null, trackWidth: rect(track)?.w ?? null },
  };
};

const browser = await chromium.launch();
const out = {};

for (const route of ['/', '/learning']) {
  for (const vp of WIDTHS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'zh-CN' });
    // 票 78 的 FirstVisitGate 在 `profileDone` 缺失时把 `/` 让给 `/welcome`。
    // 这里量的是学习台，所以先把标记写进去。
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem('profileDone', '1');
      } catch {}
    });
    const page = await context.newPage();
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    // 首页要等一张卡出来（有卡才有四格与正文宽度）
    if (route === '/') {
      await page.waitForSelector('.sm-page-in', { timeout: 15000 }).catch(() => {});
      // 触发一轮对话，让卡片出现
      const box = page.locator('.sm-composer-input');
      if (await box.count()) {
        await box.fill('我想学布尔代数的基本运算');
        await box.press('Enter');
        await page.waitForTimeout(6000);
      }
    } else {
      await page.waitForSelector('.sm-page-in', { timeout: 15000 }).catch(() => {});
    }
    await page.waitForTimeout(500);
    out[`${route}@${vp.name}`] = await page.evaluate(PROBE);
    await context.close();
  }
}

await browser.close();
console.log(JSON.stringify(out, null, 2));
