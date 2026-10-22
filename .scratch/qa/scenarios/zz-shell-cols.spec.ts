import { test } from '@playwright/test';

/**
 * t76 第 1 条取证：正文与输入区的左右间隙必须相等。
 *
 * ## 量什么、为什么这样量
 *
 * 票面说「左右间隙差 |L−R| ≤ 1px」。这里的「间隙」是**肉眼看到的空白**：
 * 元素边缘到内容区可视边界之间的距离。
 *
 * 内容区（`#main`）是滚动容器，滚动条会吃掉它的 `clientWidth` 却不吃
 * `getBoundingClientRect().width`。所以两套口径都要给：
 *   - `dContent`：对着 `clientWidth`（滚动条以内）算 —— 布局对称性；
 *   - `dVisible`：对着 `rect.right`（含滚动条）算 —— 视觉对称性，票面
 *     记录的 47 vs 65 就是这一套（差值 = 滚动条宽）。
 *
 * 三处都量：页面根元素 / 正文列 / textarea。
 *
 * `localStorage.profileDone=1` 必须先写：`/` 外面包着 `FirstVisitGate`，
 * 没走过初识的人看到的是欢迎页，量不到首页的三段布局。
 */

const PAGES = [
  ['/', 'home'],
  ['/board', 'board'],
  ['/placement', 'placement'],
  ['/review', 'review'],
  ['/database', 'database'],
  ['/market', 'market'],
  ['/skills', 'skills'],
  ['/map', 'map'],
  ['/map/kp-bool', 'node'],
] as const;

const VIEWPORTS = [
  { name: 'wide', width: 1280, height: 800 },
  { name: 'narrow', width: 375, height: 720 },
] as const;

test.describe.configure({ mode: 'serial' });

for (const vp of VIEWPORTS) {
  for (const [route, slug] of PAGES) {
    test(`左右间隙对称 @ ${slug} ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.addInitScript(() => {
        try {
          window.localStorage.setItem('profileDone', '1');
        } catch {
          /* 隐私模式 */
        }
      });
      await page.goto(route);
      await page.waitForTimeout(1200);

      const m = await page.evaluate(() => {
        const main = document.getElementById('main') as HTMLElement | null;
        if (!main) return null;
        const r = main.getBoundingClientRect();
        const leftEdge = r.left + main.clientLeft;
        const contentRight = leftEdge + main.clientWidth;
        const round = (n: number) => Math.round(n * 100) / 100;

        const gaps = (el: Element | null) => {
          if (!el) return null;
          const b = el.getBoundingClientRect();
          if (b.width === 0 && b.height === 0) return null;
          const gl = round(b.left - leftEdge);
          const grContent = round(contentRight - b.right);
          const grVisible = round(r.right - b.right);
          return {
            gl,
            grContent,
            grVisible,
            dContent: round(Math.abs(gl - grContent)),
            dVisible: round(Math.abs(gl - grVisible)),
            w: round(b.width),
          };
        };

        const pageRoot = main.querySelector('.sm-page-in > *') ?? main.firstElementChild;
        const bodyCol = pageRoot
          ? Array.from(pageRoot.querySelectorAll('*')).find((el) => {
              const b = el.getBoundingClientRect();
              return b.width > 120 && b.height > 40 && b.left > 0;
            }) ?? null
          : null;
        const textarea = main.querySelector('textarea');
        // 首页的输入区容器：textarea 往上找到那一列（composer）。
        const composer = textarea?.closest('div[class]')?.parentElement ?? null;

        return {
          sb: Math.round(r.width - main.clientWidth),
          of: main.scrollHeight - main.clientHeight,
          page: gaps(pageRoot),
          body: gaps(bodyCol),
          input: gaps(textarea),
          composer: gaps(composer),
        };
      });

      const f = (label: string, g: ReturnType<typeof Object> | null) => {
        const v = g as { gl: number; grContent: number; grVisible: number; dContent: number; dVisible: number; w: number } | null;
        if (!v) return `${label} —`;
        return `${label} L=${v.gl} Rc=${v.grContent} dC=${v.dContent} Rv=${v.grVisible} dV=${v.dVisible} w=${v.w}`;
      };

      // eslint-disable-next-line no-console
      console.log(
        `[t76] ${slug.padEnd(10)} ${vp.name.padEnd(7)} sb=${m?.sb ?? '?'} of=${m?.of ?? '?'}\n` +
          `        ${f('page', m?.page ?? null)}\n` +
          `        ${f('body', m?.body ?? null)}\n` +
          `        ${f('input', m?.input ?? null)}  ${f('composer', m?.composer ?? null)}`,
      );
    });
  }
}
