/**
 * 票 t47「窄视口下知识地图画布塌成 0」的验收测试。
 *
 * ## 缺陷是什么
 *
 * 地图页的栅格是 `minmax(0, 1fr) 340px`：右列固定 340px，左列允许缩到 0。
 * 视口 400px 时左列算出来是 `400 - 64(padding) - 16(gap) - 340 = -20`，被
 * `minmax(0, …)` 夹到 0 —— 画布容器宽度归零。sigma 的 `resize()` 在
 * `offsetWidth === 0` 时直接抛 `Sigma: Container has no width`，而它挂在
 * `window` 的 resize 回调链上（`scheduleRefresh()` → 下一帧 `render()` →
 * `this.resize()`），落在 React 错误边界之外，于是**每次窗口 resize 都是一
 * 条真实的未捕获错误**。
 *
 * ## 为什么断言必须在这里
 *
 * jsdom 没有布局引擎：`getBoundingClientRect()` 永远返回 0，`offsetWidth`
 * 恒为 0。也就是说在 jsdom 里，**每一块画布都「宽度为 0」**，测不出这个
 * 缺陷，也测不出修复。真实宽度只有 bundled Chromium 量得出来。
 *
 * ## 断言的取舍
 *
 * 不写「宽度必须是某个具体值」—— 那取决于 padding、滚动条、字体度量，是
 * 脆的。这里断言的是**缺陷的两个可观察后果**：
 * 1. 任何一档宽度下画布与它的 webgl 层都有非零宽度（不是被挤没了）；
 * 2. 全程没有未捕获的 `Sigma: Container has no width`。
 * 再加两条「修复不能靠牺牲别的东西」的反向约束：
 * 3. 节点清单在任何一档宽度下都还在（票 03 第 7 条：清单是画布的等价文本，
 *    窄屏把它藏掉等于删掉无障碍出口）；
 * 4. ≤1080px 时清单落在画布**下方**（单列），而不是继续挤在同一行。
 */
import { expect, test } from '@playwright/test';

/**
 * 票面原文的七档宽度。320 是 iPhone SE 一代的视口，375/400 是主流手机，
 * 600/900 是平板与窄窗口，1080/1440 是桌面 —— 1080 正好是栅格切单列的
 * 阈值，必须两档都测，否则「阈值写错一位」这种错误测不出来。
 */
const WIDTHS = [1440, 1080, 900, 600, 400, 375, 320] as const;

/** 栅格切单列的阈值，与 `MapPage` 的 `body` 和 `graph.css` 的媒体查询同值。 */
const NARROW_MAX = 1080;

/**
 * 页面就绪预算。`/map` 要拉回全部叶节点再交给 sigma 建 WebGL 画布，本机
 * 无 GPU 走 SwiftShader，冷加载 5–20 秒都见过（与 `graph.spec.ts` 的
 * `READY` 同源）。这里同样用 60 秒：真坏了是永远不出现，不是 60 秒后才出现。
 */
const READY = 60_000;

test.describe.configure({ timeout: 180_000 });

test('七档视口宽度下画布都非零宽，且清单始终可浏览', async ({ page }) => {
  /** 每一档收集到的未捕获错误，最后一起断言。 */
  const pageErrors: string[] = [];
  page.on('pageerror', (cause) => {
    pageErrors.push(cause.message);
  });

  /** 逐档量一次真实布局，顺便把结论打出来方便人肉扫。 */
  const measure = async () =>
    page.evaluate(() => {
      const outer = document.querySelector('.graph-canvas') as HTMLElement | null;
      const webgl = document.querySelector('.graph-canvas-webgl') as HTMLElement | null;
      const roster = document.querySelector('.graph-roster') as HTMLElement | null;
      const blocked = document.querySelector('.graph-canvas-blocked') as HTMLElement | null;
      const outerBox = outer?.getBoundingClientRect() ?? null;
      const rosterBox = roster?.getBoundingClientRect() ?? null;
      return {
        outerWidth: outerBox ? Math.round(outerBox.width) : -1,
        outerBottom: outerBox ? Math.round(outerBox.bottom) : -1,
        webglWidth: webgl ? Math.round(webgl.getBoundingClientRect().width) : -1,
        rosterWidth: rosterBox ? Math.round(rosterBox.width) : -1,
        rosterHeight: rosterBox ? Math.round(rosterBox.height) : -1,
        rosterTop: rosterBox ? Math.round(rosterBox.top) : -1,
        rosterItems: document.querySelectorAll('.graph-roster-item').length,
        blocked: blocked !== null,
      };
    });

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/map', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.graph-canvas')).toBeVisible({ timeout: READY });
    // 栅格与 `min-width` 都要等一次布局落定，首帧量到的还是旧值。
    await page.waitForTimeout(600);

    const measured = await measure();
    console.log(
      `width=${String(width).padStart(4)} -> canvas=${String(measured.outerWidth).padStart(4)} ` +
        `webgl=${String(measured.webglWidth).padStart(4)} roster=${String(measured.rosterWidth).padStart(4)} ` +
        `rosterH=${String(measured.rosterHeight).padStart(4)} ` +
        `items=${measured.rosterItems} blocked=${measured.blocked ? 1 : 0}`,
    );

    // 1. 画布本身没有被挤成 0。这是缺陷的直接症状。
    expect(measured.outerWidth, `width=${width}：画布宽度塌成 ${measured.outerWidth}px`).toBeGreaterThan(0);

    /**
     * 2. webgl 层也非零。它是 `position: absolute; inset: 0`，宽度完全跟随
     *    父级 —— 如果父级有宽度而它没有，说明另有问题（比如被 `min-width`
     *    撑开的只是父级、内容盒仍是 0），值得单独红。
     */
    expect(measured.webglWidth, `width=${width}：webgl 层宽度 ${measured.webglWidth}px`).toBeGreaterThan(0);

    // 3. 清单还在（不许用「窄屏藏清单」换宽度）。
    expect(measured.rosterItems, `width=${width}：节点清单空了`).toBeGreaterThan(0);
    expect(measured.rosterWidth, `width=${width}：清单宽度 ${measured.rosterWidth}px`).toBeGreaterThan(0);
    /**
     * 3b. 清单还得**真的有高度**。
     *
     * 只断言宽度是不够的：切单列后画布与侧栏各占一行，第二行是 `auto`，
     * 而清单是滚动容器（`overflow-y: auto` + `min-height: 0`），对 `auto`
     * 行的固有高度贡献为 0 —— 宽度 720px、400 条 `li` 都在 DOM 与无障碍树
     * 里、`isVisible()` 也报可见，但屏幕上只剩「图例 + 显示更多按钮」，
     * 中间一片空白。实测这一条不做时 1024 / 900 / 375 三档清单高度都是 0。
     *
     * 下限取 120px（约三行半），既能抓住「塌成 0」，又不会因为字号/行高
     * 的微调而误红。
     */
    expect(measured.rosterHeight, `width=${width}：清单高度 ${measured.rosterHeight}px，视觉上不可浏览`).toBeGreaterThan(120);

    /**
     * 4. ≤1080px 时清单落到画布下方。
     *
     * 用 `rosterTop >= outerBottom - 1`（1px 容差给亚像素取整）。这一条是
     * 「单列」的直接证据：两列时清单的 top 与画布的 top 基本相同，而单列时
     * 它一定在画布的 bottom 之下。
     */
    if (width <= NARROW_MAX) {
      expect(
        measured.rosterTop,
        `width=${width}：清单 top=${measured.rosterTop} 仍在画布 bottom=${measured.outerBottom} 之上，没有切单列`,
      ).toBeGreaterThanOrEqual(measured.outerBottom - 1);
    }
  }

  /**
   * 5. 全程零未捕获错误。
   *
   * 这是缺陷最刺眼的部分：`Sigma: Container has no width` 不是被 `catch`
   * 掉的异常，而是每次 resize 都重新抛一次的真 pageerror。修复前这条会
   * 攒到 2 条以上（视口切几次就几条）。
   */
  expect(
    pageErrors.filter((message) => message.includes('Container has no width')),
    `仍有 sigma 的宽度异常：${JSON.stringify(pageErrors)}`,
  ).toHaveLength(0);
  expect(pageErrors, `出现了未捕获错误：${JSON.stringify(pageErrors)}`).toHaveLength(0);
});

/**
 * 宽度恢复后画布要自己回来。
 *
 * `GraphCanvas` 在量不到宽度时渲染的是「放不下」的说明，而不是永远放弃 ——
 * 窗口拉宽（或转屏）之后 `ResizeObserver` 应当把 sigma 建起来。这条用例
 * 钉住「降级是暂时的」，防止将来把 `needsWidth` 写成一次性判定。
 */
test('从窄视口拉宽后画布自动恢复', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (cause) => {
    pageErrors.push(cause.message);
  });

  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/map', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.graph-canvas')).toBeVisible({ timeout: READY });
  await page.waitForTimeout(600);

  // 窄屏下画布已经有宽度（栅格切单列），所以这里量到的是真实的非零值。
  const before = await page.evaluate(
    () => document.querySelector('.graph-canvas')?.getBoundingClientRect().width ?? 0,
  );
  expect(before).toBeGreaterThan(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  // 等画布长到宽屏的尺寸，而不是固定 sleep。
  await expect
    .poll(
      async () =>
        page.evaluate(() => document.querySelector('.graph-canvas')?.getBoundingClientRect().width ?? 0),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(before);

  // 宽屏下 webgl 层必须真的建起来了（sigma 构造成功）。
  await expect
    .poll(
      async () =>
        page.evaluate(() => document.querySelector('.graph-canvas-webgl')?.getBoundingClientRect().width ?? 0),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);

  expect(pageErrors.filter((message) => message.includes('Container has no width'))).toHaveLength(0);
});
