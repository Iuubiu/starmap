# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: graph.spec.ts >> 图谱与看板的导航一致性 >> 从地图点进详情，再返回地图时落到该节点为焦点的视图
- Location: e2e\graph.spec.ts:651:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.graph-roster-item').first()
Expected: visible
Timeout: 60000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('.graph-roster-item').first() with timeout 60000ms
  - waiting for locator('.graph-roster-item').first()
    - waiting for "http://localhost:5173/map" navigation to finish...
    - navigated to "http://localhost:5173/map"

```

```yaml
- text: "[plugin:vite:oxc] Transform failed with 1 error: [PARSE_ERROR] Expected `,` or `}` but found `-` ╭─[ src/theme/tokens.ts:163:24 ] │ 120 │ export const darkPalette: Palette = { │ ┬ │ ╰── Opened here │ 163 │ * 的图例与清单仍走 bg-*/text-* 这些页面语义键 —— 两套主题差在 chrome， │ ┬ │ ╰── `,` or `}` expected ─────╯ D:/DeepSeek/starmap/apps/web/src/theme/tokens.ts at transformWithOxc (file:///D:/DeepSeek/starmap/node_modules/.pnpm/vite@8.3.4_@types+node@24.1_3849989234470819b44aa2ada2548bf8/node_modules/vite/dist/node/chunks/node.js:7581:19) at TransformPluginContext.transform (file:///D:/DeepSeek/starmap/node_modules/.pnpm/vite@8.3.4_@types+node@24.1_3849989234470819b44aa2ada2548bf8/node_modules/vite/dist/node/chunks/node.js:7653:26) at EnvironmentPluginContainer.transform (file:///D:/DeepSeek/starmap/node_modules/.pnpm/vite@8.3.4_@types+node@24.1_3849989234470819b44aa2ada2548bf8/node_modules/vite/dist/node/chunks/node.js:8545:51) at async loadAndTransform (file:///D:/DeepSeek/starmap/node_modules/.pnpm/vite@8.3.4_@types+node@24.1_3849989234470819b44aa2ada2548bf8/node_modules/vite/dist/node/chunks/node.js:20184:26) Click outside, press Esc key, or fix the code to dismiss. You can also disable this overlay by setting"
- code: server.hmr.overlay
- text: to
- code: "false"
- text: in
- code: vite.config.ts
- text: .
```

# Test source

```ts
  557 |     /**
  558 |      * 与上一条同样的成本结构：`/map` 冷加载就要 6–11 秒（1789 个叶节点、
  559 |      * 466 KB 响应、SwiftShader 软渲染），再加上连点三次缩放按钮（每次让
  560 |      * sigma 重算相机并刷新渲染，实测 0.3–0.6 秒）。预算走文件级 120 秒。
  561 |      */
  562 |     await page.goto('/map');
  563 |     await expect(canvas(page)).toBeVisible({ timeout: READY });
  564 | 
  565 |     const ratio = async () => Number(await canvas(page).getAttribute('data-camera-ratio'));
  566 |     const before = await ratio();
  567 | 
  568 |     await page.getByRole('button', { name: '缩小图谱' }).click();
  569 |     // 必须等 ratio 真的落地再点下一个：点击只是把相机切到动画，立刻连点
  570 |     // 第二、第三个会让三个动画叠在一起，`toBe(1)` 读到中间值。
  571 |     await expect.poll(ratio, { timeout: 10_000 }).toBeGreaterThan(before);
  572 | 
  573 |     await page.getByRole('button', { name: '放大图谱' }).click();
  574 |     await expect.poll(ratio, { timeout: 10_000 }).toBe(before);
  575 | 
  576 |     await page.getByRole('button', { name: '复位图谱视野' }).click();
  577 |     await expect.poll(ratio, { timeout: 10_000 }).toBe(1);
  578 |   });
  579 | });
  580 | 
  581 | test.describe('票 03 第 7 条：全键盘可达', () => {
  582 |   test('Tab 能逐个走到节点清单里的按钮', async ({ page }) => {
  583 |     await page.goto('/map');
  584 |     await expect(rosterItems(page).first()).toBeVisible({ timeout: READY });
  585 | 
  586 |     // 清点可聚焦的清单项
  587 |     const total = await rosterItems(page).count();
  588 |     expect(total).toBeGreaterThan(100);
  589 | 
  590 |     // 从第一个清单项开始，连按 Tab，必须连续落在清单项上
  591 |     await rosterItems(page).first().focus();
  592 |     await expect(rosterItems(page).first()).toBeFocused();
  593 | 
  594 |     for (let i = 0; i < 5; i += 1) {
  595 |       await page.keyboard.press('Tab');
  596 |       const focusedIsItem = await page.evaluate(() =>
  597 |         (document.activeElement as HTMLElement | null)?.classList.contains('graph-roster-item'),
  598 |       );
  599 |       expect(focusedIsItem, `第 ${String(i + 1)} 次 Tab 之后焦点跑出了节点清单`).toBe(true);
  600 |     }
  601 |   });
  602 | 
  603 |   test('清单项的焦点环可见（深色背景下不能丢失焦点指示）', async ({ page }) => {
  604 |     await page.goto('/map');
  605 |     await expect(rosterItems(page).first()).toBeVisible({ timeout: READY });
  606 |     await rosterItems(page).first().focus();
  607 |     // :focus-visible 的描边由 graph.css 给；这里断言它确实生效了
  608 |     const outline = await rosterItems(page)
  609 |       .first()
  610 |       .evaluate((el) => getComputedStyle(el).outlineWidth);
  611 |     expect(outline).not.toBe('0px');
  612 |   });
  613 | 
  614 |   test('Enter 从清单项进入关卡', async ({ page }) => {
  615 |     await page.goto('/map');
  616 |     await expect(rosterItems(page).first()).toBeVisible({ timeout: READY });
  617 | 
  618 |     const first = rosterItems(page).first();
  619 |     const label = await first.getAttribute('aria-label');
  620 |     const name = (label ?? '').split('，')[0];
  621 |     await first.focus();
  622 |     await page.keyboard.press('Enter');
  623 |     await expect(page).toHaveURL(/\/map\/.+/);
  624 |     await expect(page.getByRole('heading', { name })).toBeVisible();
  625 |   });
  626 | 
  627 |   test('画布容器对读屏隐藏，等价信息由清单与 aria-live 承担', async ({ page }) => {
  628 |     await page.goto('/map');
  629 |     await expect(canvas(page)).toBeVisible({ timeout: READY });
  630 | 
  631 |     // WebGL 层是 aria-hidden：里面没有可读内容，不该被读屏扫到
  632 |     await expect(page.locator('.graph-canvas-webgl')).toHaveAttribute('aria-hidden', 'true');
  633 | 
  634 |     // 视野描述是 aria-live 的，读屏用户能听到「现在看的是哪一块、多少个点」
  635 |     const description = page.locator('[data-view-description]');
  636 |     await expect(description).toHaveAttribute('aria-live', 'polite');
  637 |     await expect(description).toContainText('个微知识点');
  638 |   });
  639 | 
  640 |   test('缩放入口可用键盘操作', async ({ page }) => {
  641 |     await page.goto('/map');
  642 |     await expect(canvas(page)).toBeVisible({ timeout: READY });
  643 |     const zoomIn = page.getByRole('button', { name: '放大图谱' });
  644 |     await zoomIn.focus();
  645 |     await expect(zoomIn).toBeFocused();
  646 |     await page.keyboard.press('Enter');
  647 |   });
  648 | });
  649 | 
  650 | test.describe('图谱与看板的导航一致性', () => {
  651 |   test('从地图点进详情，再返回地图时落到该节点为焦点的视图', async ({ page }) => {
  652 |     // 票 13 落地后 `/board` 是「今日推荐 + 摘要 + 常用指令」，不再是知识点卡片
  653 |     // 网格（那个职责在票 01 时属于 `/board`，后来搬到 `/map`）。所以这条用例
  654 |     // 从地图起步 —— 它要验的本来就是「从地图进详情、从详情回地图」这条往返
  655 |     // 路径，`/board` 只是当时恰好有个能点的节点列表。
  656 |     await page.goto('/map');
> 657 |     await expect(rosterItems(page).first()).toBeVisible({ timeout: READY });
      |                                             ^ Error: expect(locator).toBeVisible() failed
  658 |     // 五态词表全列，别只写三个：正则漏掉某个状态时的症状是「那种状态的节点
  659 |     // 一个都匹配不到」，看起来像界面空了，实际只是正则少写了一个词。
  660 |     //
  661 |     // 必须把查找范围收进清单（`aria-label="当前视野内的微知识点"`）里。不收
  662 |     // 范围的话 `.first()` 命中的是**图例的筛选按钮**（可访问名形如「已掌握
  663 |     // 0/0」）—— 它名字里也有状态词、也确实可见，点它是「按状态过滤」而不是
  664 |     // 「打开这个知识点」，于是用例永远停在 `/map`，报出来的却是「URL 不对」。
  665 |     const roster = page.getByRole('list', { name: '当前视野内的微知识点' });
  666 |     const item = roster.getByRole('button', { name: /未学习|刚接触|已熟悉|已熟练|已掌握/ }).first();
  667 |     await expect(item).toBeVisible({ timeout: READY });
  668 |     const label = await item.getAttribute('aria-label');
  669 |     const name = (label ?? '').split('，')[0];
  670 | 
  671 |     await item.click();
  672 |     await expect(page).toHaveURL(/\/map\/.+/);
  673 |     await expect(page.getByRole('heading', { name })).toBeVisible();
  674 | 
  675 |     await page.getByRole('button', { name: '返回地图' }).click();
  676 |     await expect(page).toHaveURL(/focus=/);
  677 |     await expect(canvas(page)).toBeVisible({ timeout: READY });
  678 |   });
  679 | 
  680 |   test('顶栏切到知识地图后画布就绪', async ({ page }) => {
  681 |     await page.goto('/');
  682 |     await page.getByRole('tab', { name: '知识地图' }).click();
  683 |     await expect(page).toHaveURL(/\/map/);
  684 |     await expect(canvas(page)).toBeVisible({ timeout: READY });
  685 |   });
  686 | });
  687 | 
  688 | test.describe('无障碍名沿用既有格式（不弄坏 smoke.spec.ts）', () => {
  689 |   test('清单项的可访问名是「名称，状态，百分比/证据不足」', async ({ page }) => {
  690 |     await page.goto('/map');
  691 |     await expect(rosterItems(page).first()).toBeVisible({ timeout: READY });
  692 | 
  693 |     const labels = await rosterItems(page).evaluateAll((items) =>
  694 |       items.slice(0, 20).map((item) => item.getAttribute('aria-label') ?? ''),
  695 |     );
  696 |     for (const label of labels) {
  697 |       const parts = label.split('，');
  698 |       expect(parts).toHaveLength(3);
  699 |       expect(parts[0]?.length ?? 0).toBeGreaterThan(0);
  700 |       // 五档状态词表（smoke.spec.ts 用这组词匹配）
  701 |       expect(['未学习', '刚接触', '已熟悉', '已熟练', '已掌握']).toContain(parts[1]);
  702 |       expect(/^(\d+%|证据不足)$/.test(parts[2] ?? '')).toBe(true);
  703 |     }
  704 |   });
  705 | 
  706 |   test('清单上看得见的状态文字只能来自五态词表', async ({ page }) => {
  707 |     await page.goto('/map');
  708 |     await expect(rosterItems(page).first()).toBeVisible({ timeout: READY });
  709 | 
  710 |     // 这条原来是 `getByText('已熟悉').toBeVisible()`，注释写着「真实数据里 kp-bool
  711 |     // 就是 familiar」。它断言的其实不是界面行为，而是「库里恰好有一个 familiar
  712 |     // 节点」—— 那个 familiar 来自 seed.sql 手写的一行掌握度快照，而它声称的 10
  713 |     // 次作答在 `app.attempts` 里一条都没有（伪造的证据，已随迁移 0005 与 seed
  714 |     // 一并删除）。删掉假数据后这条就红了，说明它钉的是数据。
  715 |     //
  716 |     // 换成只看渲染规则的断言：清单每一条都渲染了状态文字，且两层词都在各自的
  717 |     // 词表里。词表漏翻（露出 `familiar` 这类英文原值）或多出一个契约里不存在的
  718 |     // 词时才会红。
  719 |     //
  720 |     // 注意是**两层**词：括号外是四类显示桶（未学/在学/已掌握/需复验，票 03 的
  721 |     // 画布分类），括号里是五档引擎状态（`FINE_LABEL`）。写成一层会混淆这两件事。
  722 |     const BUCKET_LABEL = ['未学', '在学', '已掌握', '需复验'];
  723 |     const FINE_LABEL = ['未学习', '刚接触', '已熟悉', '已熟练', '已掌握'];
  724 |     const states = await rosterItems(page).evaluateAll((items) =>
  725 |       items.slice(0, 30).map((item) => item.querySelector('.graph-roster-state')?.textContent ?? ''),
  726 |     );
  727 |     expect(states.length).toBeGreaterThan(0);
  728 |     for (const text of states) {
  729 |       const [outer = '', inner = ''] = text.split('（');
  730 |       expect(BUCKET_LABEL).toContain(outer);
  731 |       expect(FINE_LABEL).toContain(inner.replace('）', ''));
  732 |     }
  733 |   });
  734 | });
  735 | 
```