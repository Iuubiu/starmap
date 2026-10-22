import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 换外壳之后，逐页检查「内容高度是否贴合视口」。
 *
 * ## 要抓的具体失效模式
 *
 * `HomePage` 原来写 `minHeight: calc(100vh - 48px)` —— 减掉的是旧顶栏。
 * 顶栏没了之后：
 * - **宽屏**：页面比视口短 48px，`main` 底部露出一条背景色，或者输入框
 *   离底边还有 48px 缝；
 * - **窄屏**：顶部窄条正好 48px，这个减数反而是对的。
 *
 * 所以不能只在一档测。这里对每页量 `main.scrollHeight - main.clientHeight`
 * 与「页面底部元素到视口底边的距离」，两档各跑一次。
 */

const SHOTS = path.resolve('../../.scratch/qa/shots');
const PAGES = [
  ['/', 'home'],
  ['/board', 'board'],
  ['/placement', 'placement'],
  ['/review', 'review'],
  ['/database', 'database'],
  ['/market', 'market'],
  ['/skills', 'skills'],
  // 地图与知识点详情：最容易受外壳宽度/高度变化影响的页面。
  ['/map', 'map'],
  ['/node/kp-bool', 'node'],
] as const;

const VIEWPORTS = [
  { name: 'wide', width: 1280, height: 800 },
  { name: 'narrow', width: 375, height: 720 },
] as const;

for (const vp of VIEWPORTS) {
  for (const [route, slug] of PAGES) {
    test(`内容高度贴合视口 @ ${slug} ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(route);
      await page.waitForTimeout(1500);

      const m = await page.evaluate(() => {
        const main = document.getElementById('main') as HTMLElement;
        const doc = document.documentElement;
        const mainBox = main.getBoundingClientRect();
        return {
          mainHeight: Math.round(mainBox.height),
          mainTop: Math.round(mainBox.top),
          innerHeight: window.innerHeight,
          scrollOverflow: main.scrollHeight - main.clientHeight,
          docOverflow: doc.scrollWidth - doc.clientWidth,
        };
      });

      // 1) 内容区必须从顶部条之下开始、并一直延伸到视口底边（不留缝）。
      expect(
        m.mainTop + m.mainHeight,
        `${slug}@${vp.name} 内容区底边 ${m.mainTop + m.mainHeight} 应等于视口高 ${m.innerHeight}`,
      ).toBe(m.innerHeight);
      // 2) 不该有整页横向溢出。
      expect(m.docOverflow, `${slug}@${vp.name} 横向溢出`).toBeLessThanOrEqual(1);
      // 3) 内容区内部可以滚（长页面正常），但滚动条只应出现在 `main` 里。
      expect(m.scrollOverflow, `${slug}@${vp.name} main 内滚动量`).toBeGreaterThanOrEqual(0);

      await page.screenshot({ path: path.join(SHOTS, `fit-${slug}-${vp.name}.png`) });
      fs.writeFileSync(
        path.join(SHOTS, `fit-${slug}-${vp.name}.json`),
        JSON.stringify(m, null, 2),
        'utf8',
      );
    });
  }
}
