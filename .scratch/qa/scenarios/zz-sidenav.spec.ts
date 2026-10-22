import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 侧边导航栏的版式验收：三档宽度各截一张，并量出「有没有横向溢出」。
 *
 * 为什么必须真浏览器：侧栏/抽屉的分支由 `matchMedia` 决定，而「有没有横向
 * 溢出」是 `scrollWidth` 与 `clientWidth` 的关系 —— jsdom 两样都不给。
 */

const SHOTS = path.resolve('../../.scratch/qa/shots');
const VIEWPORTS = [
  { name: 'wide-1280', width: 1280, height: 800, narrow: false },
  { name: 'mid-900', width: 900, height: 800, narrow: false },
  { name: 'narrow-375', width: 375, height: 720, narrow: true },
] as const;

type Metrics = {
  docScroll: number;
  docClient: number;
  overflow: number;
  railWidth: number;
  railLeft: number;
  compactBar: number;
  mainLeft: number;
  mainWidth: number;
};

async function measure(page: Page): Promise<Metrics> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const rail = document.getElementById('app-nav') as HTMLElement | null;
    const main = document.getElementById('main') as HTMLElement | null;
    const railBox = rail?.getBoundingClientRect();
    const mainBox = main?.getBoundingClientRect();
    const compact =
      document.querySelector('header')?.getBoundingClientRect().height ?? 0;
    return {
      docScroll: doc.scrollWidth,
      docClient: doc.clientWidth,
      overflow: doc.scrollWidth - doc.clientWidth,
      railWidth: Math.round(railBox?.width ?? 0),
      railLeft: Math.round(railBox?.left ?? 0),
      compactBar: Math.round(compact),
      mainLeft: Math.round(mainBox?.left ?? 0),
      mainWidth: Math.round(mainBox?.width ?? 0),
    };
  });
}

for (const vp of VIEWPORTS) {
  test(`侧栏版式 @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/board');
    await page.getByRole('navigation', { name: '主导航' }).waitFor();
    await page.waitForTimeout(1200);

    const before = await measure(page);
    await page.screenshot({ path: path.join(SHOTS, `nav-${vp.name}.png`) });

    /* 全站不该有横向滚动条。这正是顶栏版本在 375px 下的失效模式
       （实测溢出 304px），侧栏把它从结构上消掉了。 */
    expect(before.overflow, `${vp.name} 横向溢出 ${before.overflow}px`).toBeLessThanOrEqual(1);

    if (vp.narrow) {
      // 抽屉：默认在视口外、不占列、内容占满整宽。
      expect(before.railLeft, '窄屏抽屉应移出视口').toBeLessThan(0);
      expect(before.mainLeft, '窄屏内容应贴左').toBeLessThanOrEqual(1);
      expect(before.mainWidth).toBeGreaterThanOrEqual(vp.width - 1);
      expect(before.compactBar, '窄屏应有 48px 顶部条').toBeGreaterThanOrEqual(40);

      // 打开抽屉后它应当完全进入视口，且遮罩可点。
      await page.getByRole('button', { name: '打开导航' }).click();
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(SHOTS, `nav-${vp.name}-drawer.png`) });
      const opened = await measure(page);
      expect(opened.railLeft, '抽屉打开后应贴左').toBeGreaterThanOrEqual(-1);
      expect(opened.railWidth, '抽屉宽度应是 240').toBeGreaterThanOrEqual(200);

      // 点遮罩关闭。
      await page.mouse.click(vp.width - 12, vp.height - 12);
      await page.waitForTimeout(300);
      const closed = await measure(page);
      expect(closed.railLeft, '点遮罩后抽屉应收回').toBeLessThan(0);
    } else {
      // 宽屏：常驻侧栏，内容从侧栏右边开始，没有抽屉入口。
      expect(before.railLeft, '宽屏侧栏应贴左').toBeGreaterThanOrEqual(-1);
      expect(before.railWidth, '宽屏侧栏宽度 240/200').toBeGreaterThanOrEqual(200);
      expect(before.mainLeft, '内容应紧接侧栏右侧').toBeGreaterThanOrEqual(
        before.railWidth - 1,
      );
      expect(before.compactBar, '宽屏不应有顶部条').toBe(0);
      expect(await page.getByRole('button', { name: '打开导航' }).count()).toBe(0);
    }

    fs.writeFileSync(
      path.join(SHOTS, `nav-${vp.name}.json`),
      JSON.stringify(before, null, 2),
      'utf8',
    );
  });
}
