import { expect, test } from '@playwright/test';

/**
 * 票 76 的三件外壳改动的取证。
 *
 * 1. **三列对齐**：正文与输入区必须落在中间那一列，左右空白相等。这里量的
 *    是 `#main`（滚动容器）以内：`clientWidth` 已经扣掉滚动条，`rect` 没有。
 *    `scrollbar-gutter: stable both-edges` 的意义正在于此 —— 两侧各让 15px，
 *    于是两套口径都不偏。
 * 2. **导航激活态**：底色是白色叠加（alpha ≤ 0.12），不是实心白；图标是
 *    `...Filled` 那一支；左侧 2px 竖条由 `::before` 画。
 * 3. **窄屏不渲染第二列**：`56px minmax(0,1fr)` 两列，品牌+导航在抽屉里，
 *    不是第三列。
 *
 * 另外把「玻璃容器没有边框」也顺手量了 —— 三列改造最容易的退化就是给内容区
 * 补一条 1px 描边把边界画出来，那会立刻变成「卡片套卡片」。
 */

const PAGES = [
  ['/', 'home'],
  ['/learning', 'learning'],
  ['/board', 'board'],
  ['/placement', 'placement'],
  ['/review', 'review'],
  ['/database', 'database'],
  ['/market', 'market'],
  ['/skills', 'skills'],
  ['/map', 'map'],
  // 票面点名的第 9 页是知识点详情（/map/:microKpId），它没有输入区，只量正文。
  ['/map/kp-bool', 'node'],
] as const;

const VIEWPORTS = [
  { name: 'wide', width: 1280, height: 800 },
  { name: 'narrow', width: 375, height: 720 },
] as const;

test.describe.configure({ mode: 'serial' });

test.use({ colorScheme: 'dark' });

for (const vp of VIEWPORTS) {
  for (const [route, slug] of PAGES) {
    test(`内容区左右对称 @ ${slug} ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.addInitScript(() => {
        try {
          window.localStorage.setItem('profileDone', '1');
          window.localStorage.setItem('starmap.theme', 'dark');
        } catch {
          /* 隐私模式 */
        }
      });
      await page.goto(route);
      await page.waitForFunction(() => document.getElementById('main') !== null);
      await page.waitForTimeout(800);

      const m = await page.evaluate(() => {
        const main = document.getElementById('main') as HTMLElement | null;
        if (!main) return null;
        const rect = main.getBoundingClientRect();
        const leftEdge = rect.left + main.clientLeft;
        const contentRight = leftEdge + main.clientWidth;
        const round = (n: number) => Math.round(n * 100) / 100;

        const gaps = (el: Element | null) => {
          if (!el) return null;
          const b = el.getBoundingClientRect();
          if (b.width === 0 && b.height === 0) return null;
          const gl = round(b.left - leftEdge);
          const grContent = round(contentRight - b.right);
          /* 视觉口径必须**两侧都算上各自的 gutter**：`scrollbar-gutter:
             stable both-edges` 让两侧各留 15px 空白，只把右边算进去会得到
             「左边 124、右边 139」这种假不对称。 */
          const glVisible = round(b.left - rect.left);
          const grVisible = round(rect.right - b.right);
          return {
            gl,
            grContent,
            grVisible,
            glVisible,
            dContent: round(Math.abs(gl - grContent)),
            dVisible: round(Math.abs(glVisible - grVisible)),
            w: round(b.width),
          };
        };

        const pageIn = main.querySelector('.sm-page-in');
        const pageRoot = pageIn?.firstElementChild ?? main.firstElementChild;
        const textarea = main.querySelector('textarea');
        /* 输入区看的是「它在自己所属的那一列里是否居中」，不是「相对滚动容器」：
           首页的输入条横跨整页两栏（内容 + 学习日志），拿它跟 `#main` 比左右
           必然差一条日志的宽度 —— 那是设计，不是缺陷。 */
        /* Fluent 的 Textarea 外面还套着一层 `<span class="fui-Textarea">`，直接量
           `textarea.parentElement` 得到的是那层壳（宽度被按钮挤掉 106px），
           会得出「左右差 106px」的假缺陷。往上两层才是输入条那一行。 */
        const inputBox = textarea
          ? (textarea.closest('form') ?? textarea.parentElement?.parentElement ?? textarea.parentElement)
          : null;
        const relGaps = (el: Element | null, base: Element | null) => {
          if (!el || !base) return null;
          const b = el.getBoundingClientRect();
          const baseRect = base.getBoundingClientRect();
          if (b.width === 0 && b.height === 0) return null;
          const gl = round(b.left - baseRect.left);
          const gr = round(baseRect.right - b.right);
          return { gl, gr, d: round(Math.abs(gl - gr)), w: round(b.width) };
        };

        const glass = Array.from(document.querySelectorAll('.sm-stage, .sm-rail, .sm-nav-panel')).map(
          (el) => ({
            cls: (el.getAttribute('class') ?? '').split(' ')[0],
            bw: getComputedStyle(el).borderTopWidth,
          }),
        );

        const grid = document.querySelector('.sm-shell-grid') as HTMLElement | null;
        const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean) : [];

        return {
          page: gaps(pageRoot),
          input: relGaps(inputBox, pageRoot),
          sb: Math.round(rect.width - main.clientWidth),
          glass,
          columns,
          navPanelInGrid: document.querySelector('.sm-shell-grid > .sm-nav-panel') !== null,
        };
      });

      expect(m, '找不到 #main').not.toBeNull();
      const pageGap = m!.page;
      expect(pageGap, `${slug} 没有页面根元素`).not.toBeNull();

      // eslint-disable-next-line no-console
      console.log(
        `[t76] ${slug.padEnd(10)} ${vp.name.padEnd(7)} sb=${m!.sb} ` +
          `page L=${pageGap!.gl} Rc=${pageGap!.grContent} dC=${pageGap!.dContent} Lv=${pageGap!.glVisible} Rv=${pageGap!.grVisible} dV=${pageGap!.dVisible} w=${pageGap!.w} ` +
          `cols=${m!.columns.join(',')} ` +
          `input gl=${m!.input?.gl ?? '-'} gr=${m!.input?.gr ?? '-'} d=${m!.input?.d ?? '-'} w=${m!.input?.w ?? '-'}`,
      );
      // 两套口径都 ≤1px：content 看布局是否真居中，visible 看肉眼是否对称。
      expect(Math.abs(pageGap!.dContent), `${slug} 页面根 dContent`).toBeLessThanOrEqual(1);
      expect(Math.abs(pageGap!.dVisible), `${slug} 页面根 dVisible`).toBeLessThanOrEqual(1);
      if (m!.input) {
        expect(m!.input.d, `${slug} 输入区在内容列内的左右间隙差`).toBeLessThanOrEqual(1);
      }
      for (const item of m!.glass) {
        expect(item.bw, `${slug} 玻璃容器 ${item.cls} 不该有边框`).toBe('0px');
      }
      if (vp.name === 'wide' && (slug === 'home' || slug === 'learning')) {
        await page.screenshot({ path: `../../.scratch/qa/shots/shell76-${slug}-wide.png` });
      }
      if (vp.name === 'wide') {
        expect(m!.columns.length, '宽屏应有三列').toBe(3);
        expect(m!.columns[0]).toBe('56px');
        expect(m!.columns[1]).toBe('216px');
      } else {
        expect(m!.columns.length, '窄屏应只有两列').toBe(2);
        expect(m!.navPanelInGrid).toBe(false);
      }

    });
  }
}

test('导航激活态：叠加底色、Filled 图标、2px 竖条', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('profileDone', '1');
      window.localStorage.setItem('starmap.theme', 'dark');
    } catch {
      /* 隐私模式 */
    }
  });
  await page.goto('/learning');
  await page.waitForFunction(() => document.getElementById('main') !== null);

  const info = await page.evaluate(() => {
    const tab = document.querySelector('[role="tab"][aria-selected="true"]') as HTMLElement | null;
    if (!tab) return null;
    const cs = getComputedStyle(tab);
    const before = getComputedStyle(tab, '::before');
    const icon = tab.querySelector('.sm-nav-icon');
    const rgb = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
    const parts = rgb ? rgb[1].split(',').map((p) => Number(p.trim())) : [];
    return {
      alpha: parts.length === 4 ? parts[3] : 1,
      color: cs.backgroundColor,
      fontWeight: Number(cs.fontWeight),
      beforeWidth: before.width,
      beforeLeft: before.left,
      iconClass: icon?.getAttribute('class') ?? '',
    };
  });

  expect(info).not.toBeNull();
  expect(info!.alpha, `激活底色 ${info!.color} 的 alpha 应 ≤0.12`).toBeLessThanOrEqual(0.12);
  expect(info!.alpha).toBeGreaterThan(0);
  expect(info!.fontWeight).toBeGreaterThanOrEqual(600);
  expect(Number.parseFloat(info!.beforeWidth)).toBe(2);
  expect(Number.parseFloat(info!.beforeLeft)).toBe(0);
  expect(info!.iconClass).toContain('Filled');

  await page.screenshot({ path: '../../.scratch/qa/shots/shell76-active-nav.png' });

  /*
   * 验收第 4 条的后半句：点「新会话」要真的落到 `/`，而且落地后的输入框
   * 能输入（不是只剩壳子）。这里用真实键盘输入而不是只看元素存在 ——
   * 输入框被 `disabled` 或 pointer-events 挡住时，`toBeVisible()` 仍然是绿的。
   */
  await page.getByRole('button', { name: '新会话' }).click();
  await page.waitForURL(/\/$/);
  const composer = page.getByLabel('这一轮想说的话');
  await composer.fill('我想学布尔代数');
  await expect(composer).toHaveValue('我想学布尔代数');
  // eslint-disable-next-line no-console
  console.log(`[t76] nav ${JSON.stringify(info)}`);
});
