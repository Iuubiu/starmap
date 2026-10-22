/**
 * 票 18 AC5「内容缺口在图上可见」的**可见性**验收。
 *
 * ## 为什么这条必须在这里，而 MapPage.test.tsx 的五条不够
 *
 * `src/pages/MapPage.test.tsx` 用的是 jsdom —— 没有布局引擎。它能证明「缺口
 * 区的 DOM 在、不在画布容器内、链接指向对的 id」，但证明不了「人真的能看见
 * 它」。这不是理论风险：实现这一块时真的踩到过 ——
 *
 * 页面根是 `height: 100%` 的 flex 列，画布格子是 `minHeight: 0` + `flex: 1 1 auto`。
 * 加进缺口区之后总高超出视口，flex 就把画布格子压到 480 以下，而画布本身有
 * `min-height: 480px` 不会跟着缩，于是它**溢出自己的格子、盖在缺口区上面**。
 * 那一刻：
 * - 缺口区在 DOM 里（`queryByText` 找得到）；
 * - 在无障碍树里（`getByRole` 找得到）；
 * - Playwright 的 `isVisible()` 也报 true —— 它只判「有非空矩形且 visibility
 *   不是 hidden」，**不判遮挡**。
 *
 * 屏幕上是整块深色画布，缺口区一个字都看不到。jsdom 测试全绿。
 *
 * 所以这里的判据是**命中测试**：把缺口区滚进视口，取它内部一点做
 * `elementFromPoint`，命中的元素必须落在缺口区自己内部。这条断言只认「真的
 * 在最上面」，不认「存在于 DOM」。
 */
import { expect, test } from '@playwright/test';

/** `/map` 冷加载要建 5500 节点的 WebGL 画布，本机无 GPU 走软件渲染，实测 15 秒起。 */
const READY = 60_000;

test.describe.configure({ timeout: 120_000 });

test('内容缺口区在屏幕上真的可见（不被画布盖住）', async ({ page }) => {
  await page.goto('/map');
  await expect(page.locator('.graph-canvas')).toBeVisible({ timeout: READY });

  const gaps = page.locator('[data-content-gaps]');
  await expect(gaps).toBeAttached({ timeout: READY });

  // 页面本身可能不够高（缺口区落在视口下方），先滚到它，再判断可见性。
  await gaps.scrollIntoViewIfNeeded();
  await expect(gaps).toBeVisible();

  /**
   * 命中测试：在缺口区矩形里取三个纵向位置，各自 `elementFromPoint`。
   * 全部必须命中缺口区自己的后代 —— 命中 `.sigma-mouse` / `.graph-canvas`
   * 就说明画布压在它上面，正是上面注释里那个缺陷的样子。
   */
  const hits = await gaps.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const points = [0.2, 0.5, 0.8].map((f) => ({
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height * f),
    }));
    return points.map(({ x, y }) => {
      const hit = document.elementFromPoint(x, y) as HTMLElement | null;
      return {
        x,
        y,
        inside: hit !== null && el.contains(hit),
        hit: hit ? `${hit.tagName}.${hit.className?.toString().slice(0, 40) ?? ''}` : null,
      };
    });
  });

  expect(hits.every((h) => h.inside), JSON.stringify(hits, null, 2)).toBe(true);
});

test('内容缺口列出库里真实的三条，且第一条带可点的「最接近的知识点」入口', async ({ page }) => {
  await page.goto('/map');
  const gaps = page.locator('[data-content-gaps]');
  await expect(gaps).toBeAttached({ timeout: READY });

  /**
   * 三条缺口的 topic 来自迁移 `0060_content_gaps.sql` 的种子。断言它们**逐字**
   * 出现，是因为这正是「缺口进数据库而不是前端常量」的可观察面：换成前端写死
   * 也能过，但库里删掉一条时这里会红 —— 那才是要的行为（内容侧改了，界面跟着改）。
   */
  for (const topic of ['数字多道分析器', 'FPGA 可编程器件', '数字脉冲处理']) {
    await expect(gaps.getByText(topic, { exact: true })).toBeVisible();
  }

  // 每条缺口都至少有一个「从最接近的知识点看起」按钮（nearestKpIds 由迁移按
  // 名字解析，解析不到时该条不给链接 —— 这里断言的是「真解析到了」）。
  const links = gaps.locator('button[data-content-gap-nearest]');
  expect(await links.count()).toBeGreaterThanOrEqual(1);

  // 点进去要能到知识点详情页，而不是死链。
  await links.first().click();
  await expect(page).toHaveURL(/\/map\/.+/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: READY });
});
