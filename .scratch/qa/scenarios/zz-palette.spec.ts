/**
 * 命令面板的真浏览器探针 —— 票 59 的验收证据。
 *
 * 单测（`apps/web/src/command/CommandPalette.test.tsx`）已经钉住交互契约，
 * 这个探针只回答单测回答不了的四件事：
 *
 * 1. 三条键盘路径在**真浏览器**里确实成立（合成事件与真实按键的差别，jsdom
 *    不会告诉你）；
 * 2. 3086 条知识点下的命中耗时（jsdom 的 `performance.now()` 有、但 CPU 环境
 *    与浏览器不同，票面要的是浏览器里的数）；
 * 3. DOM 行数不随总数增长（窗口化）—— 读的是真实渲染出来的行；
 * 4. 浮层打开时侧栏 `role=tab` 仍在无障碍树里（焦点被抢是常见可访问性回归）。
 *
 * 跑法：
 *   cd apps/web && npx playwright test \
 *     --config=../../.scratch/qa/playwright.config.ts zz-palette \
 *     --output=../../.scratch/pw-palette
 */

import { expect, test } from '@playwright/test';

const READY = 60_000;

/** 面板里的搜索框（按 aria-label 取，不依赖 class）。 */
const SEARCH_LABEL = '搜索知识点、页面或动作';

async function openPalette(page: import('@playwright/test').Page) {
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: '命令面板' });
  await expect(dialog).toBeVisible({ timeout: 5000 });
  return dialog;
}

async function openWithGraph(page: import('@playwright/test').Page) {
  /* 面板一开就开始拉图谱（共享地图页那条缓存键）。等这次响应落地，模糊搜索
     才有 3086 条可排 —— 空查询的总数只是「最近 + 页面」，不能当加载信号。 */
  const graph = page.waitForResponse(
    (response) => response.url().includes('/api/v1/graph') && response.status() === 200,
    { timeout: READY },
  );
  await openPalette(page);
  await graph;
  await expect
    .poll(async () => Number(await page.locator('.sm-palette__list').getAttribute('data-palette-total')))
    .toBeGreaterThanOrEqual(8);
}

async function search(page: import('@playwright/test').Page, query: string) {
  const input = page.getByLabel(SEARCH_LABEL);
  await input.fill(query);
  /* 等结果稳定：窗口化列表里有行，且高亮 id 指向一个不存在的空串之外的值。 */
  await expect
    .poll(async () => Number(await page.locator('.sm-palette__list').getAttribute('data-palette-rows')))
    .toBeGreaterThan(0);
}

/** 只数可选项，不数分区标题（标题也是 `.sm-palette__row`）。 */
function rows(page: import('@playwright/test').Page) {
  return page.locator('.sm-palette__row[role="option"]');
}

test.describe('三个键盘路径（真实按键）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.sm-app-shell, [data-sm-theme]', { timeout: READY });
  });

  test('Ctrl+K 打开、Esc 关闭', async ({ page }) => {
    const dialog = await openPalette(page);
    await expect(page.getByLabel(SEARCH_LABEL)).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('Cmd+K（metaKey）也能打开', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await expect(page.getByRole('dialog', { name: '命令面板' })).toBeVisible();
  });

  test('↑/↓ 逐行移动高亮，Enter 执行当前项', async ({ page }) => {
    /* 先造两条最近访问，这样空态第一行是知识点、↑↓ 有东西可移。 */
    await page.goto('/');
    await page.evaluate(() => {
      window.localStorage.setItem(
        'starmap.command.recentNodes',
        JSON.stringify(['kp-kmap', 'kp-bool']),
      );
    });
    await page.reload();
    await openWithGraph(page);

    const list = page.locator('.sm-palette__list');
    /* 键盘事件只发给焦点元素：先把「焦点在输入框」钉住，否则一次慢渲染就会
       让 ArrowDown 打到 body 上，高亮不动（这条用例真的这么飘过一次）。 */
    await expect(page.getByLabel(SEARCH_LABEL)).toBeFocused();
    const first = await list.getAttribute('data-palette-active');
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => list.getAttribute('data-palette-active')).not.toBe(first);
    const second = await list.getAttribute('data-palette-active');
    expect(second).not.toBe(first);

    await page.keyboard.press('ArrowUp');
    await expect.poll(async () => list.getAttribute('data-palette-active')).toBe(first);

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/map\/kp-kmap$/);
  });

  test('↑/↓ 移动高亮、Enter 执行（End 走到最后一个动作）', async ({ page }) => {
    await openWithGraph(page);
    await search(page, '卡诺');
    const list = page.locator('.sm-palette__list');
    /* 精确名优先：题库里还有「卡诺图化简法」「用卡诺图化简逻辑函数」等近似名，
       高亮必须落在与查询完全同名的那一个上。 */
    await expect(list).toHaveAttribute('data-palette-active', 'node:kp-kmap');

    await page.keyboard.press('End');
    await expect
      .poll(async () => page.getByLabel(SEARCH_LABEL).getAttribute('aria-activedescendant'))
      .toContain('action:generate:');

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/market\/generate\?microKpIds=/);
  });

  test('Tab / Shift+Tab 与方向键同义，焦点不离开输入框（票面验收第 4 条）', async ({ page }) => {
    await openWithGraph(page);
    const list = page.locator('.sm-palette__list');
    const input = page.getByLabel(SEARCH_LABEL);
    await expect(input).toBeFocused();

    const first = await list.getAttribute('data-palette-active');
    await page.keyboard.press('Tab');
    await expect.poll(async () => list.getAttribute('data-palette-active')).not.toBe(first);
    /* Tab 若把焦点带到面板里的按钮上，aria-activedescendant 就指向了焦点路径之外。 */
    await expect(input).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect.poll(async () => list.getAttribute('data-palette-active')).toBe(first);
    await expect(input).toBeFocused();
  });

  test('拼音首字母命中：输入 knt 找到「卡诺图化简」', async ({ page }) => {
    await openWithGraph(page);
    await search(page, 'knt');
    const list = page.locator('.sm-palette__list');
    await expect(list).toHaveAttribute('data-palette-active', 'node:kp-kmap');
    await expect(page.locator('.sm-palette__row[data-active="true"] .sm-palette__name')).toHaveText(
      '卡诺图化简',
    );
  });
});

test.describe('三件事：知识点搜索 / 页面动作 / 选中后的三个动作', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await openWithGraph(page);
  });

  test('空查询是「最近访问 + 全部页面动作」，不是空白', async ({ page }) => {
    /* 先造一段「最近访问」：空态最有用的时候，恰恰是用户刚才看过几个知识点。 */
    await page.evaluate(() => {
      window.localStorage.setItem(
        'starmap.command.recentNodes',
        JSON.stringify(['kp-kmap', 'kp-bool', 'kp-tangbin-1-2']),
      );
    });
    await page.reload();
    await openWithGraph(page);
    /* 等入场动画走完再截图：`data-motion='enter'` 有 160ms 的位移+淡入，
       第一帧截图会得到一块「只有遮罩、没有面板」的图。 */
    await page.locator('.sm-palette').waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    await page.screenshot({ path: '../../.scratch/qa/shots/palette-open.png' });

    const names = await page.locator('.sm-palette__name').allTextContents();
    expect(names.slice(0, 3)).toEqual(['卡诺图化简', '布尔代数基本运算', '放射性衰变和衰变规律']);
    expect(names).toEqual(
      expect.arrayContaining(['学习', '定级', '复验', '看板', '知识地图', '关卡市场', '数据库', '技能库']),
    );
  });

  test('「布尔」「卡诺」各命中，冷/热两次耗时都 <100ms 并被记录', async ({ page }) => {
    const list = page.locator('.sm-palette__list');
    const activeName = page.locator('.sm-palette__row[data-active="true"] .sm-palette__name');

    const started = Date.now();
    await search(page, '布尔');
    await expect(activeName).toHaveText('布尔代数基本运算');
    const coldMs = Number(await list.getAttribute('data-palette-ms'));
    const coldWall = Date.now() - started;

    await search(page, '卡诺');
    await expect(activeName).toHaveText('卡诺图化简');
    const hotMs = Number(await list.getAttribute('data-palette-ms'));

    await page.screenshot({ path: '../../.scratch/qa/shots/palette-search.png' });

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({ coldMs, hotMs, coldWallMs: coldWall, matches: await list.getAttribute('data-palette-matches') }),
    );
    expect(coldMs).toBeLessThan(100);
    expect(hotMs).toBeLessThan(100);
  });

  test('窗口化：结果总数从 600 涨到 950，DOM 行数不变', async ({ page }) => {
    const list = page.locator('.sm-palette__list');

    /* 「电」命中 609 个名字，「的」命中 954 个 —— 两个都远超一屏，正好用来看
       行数是否随总数增长。 */
    await search(page, '电');
    const firstTotal = Number(await list.getAttribute('data-palette-total'));
    const firstRows = Number(await list.getAttribute('data-palette-rows'));
    const firstDomRows = await page.locator('.sm-palette__row').count();
    const firstOptions = await rows(page).count();

    await search(page, '的');
    const secondTotal = Number(await list.getAttribute('data-palette-total'));
    const secondRows = Number(await list.getAttribute('data-palette-rows'));
    const secondDomRows = await page.locator('.sm-palette__row').count();
    const secondOptions = await rows(page).count();

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        firstTotal,
        firstRows,
        firstDomRows,
        firstOptions,
        secondTotal,
        secondRows,
        secondDomRows,
        secondOptions,
      }),
    );
    expect(firstTotal).toBeGreaterThan(500);
    expect(secondTotal).toBeGreaterThan(firstTotal);
    /* 契约：data-palette-rows 报的就是**真实渲染行数**（含分区标题）——
       数字与 DOM 里数出来的一致，才算证据而不是自称。 */
    expect(firstRows).toBe(firstDomRows);
    expect(secondRows).toBe(secondDomRows);
    expect(firstRows).toBeLessThanOrEqual(40);
    expect(secondRows).toBe(firstRows);
    expect(secondOptions).toBe(firstOptions);
  });

  test('选中知识点的三个动作可见，落点各截图', async ({ page }) => {
    await search(page, '卡诺');
    const list = page.locator('.sm-palette__list');
    await expect(list).toHaveAttribute('data-palette-active', 'node:kp-kmap');

    await expect(page.getByText('打开详情', { exact: true })).toBeVisible();
    await expect(page.getByText('去地图定位', { exact: true })).toBeVisible();
    await expect(page.getByText('生成关卡', { exact: true })).toBeVisible();
    await page.screenshot({ path: '../../.scratch/qa/shots/palette-actions.png' });

    /* 打开详情：真跳转到 /map/:id */
    await page.getByText('打开详情', { exact: true }).click();
    await expect(page).toHaveURL(/\/map\/kp-kmap$/);
  });
});

test.describe('无障碍：浮层与侧栏共存', () => {
  test('面板打开时侧栏 role=tab 仍可被辅助技术读到', async ({ page }) => {
    await page.goto('/');
    await openPalette(page);

    const tabs = page.getByRole('tab');
    const count = await tabs.count();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ sidebarTabsWhilePaletteOpen: count }));
    expect(count).toBeGreaterThanOrEqual(8);
    /* 没有被 aria-hidden 或 inert 从无障碍树里摘掉 */
    await expect(tabs.first()).toBeVisible();
    expect(await tabs.first().getAttribute('aria-hidden')).toBeNull();
  });

  test('reduce 动效偏好下仍能打开（降级的只是动画）', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const dialog = await openPalette(page);
    await expect(dialog).toHaveAttribute('data-motion', 'none');
  });
});

test.describe('索引规模', () => {
  test('模糊搜索用的是整张图谱（3085 个知识点），不是一页子集', async ({ page }) => {
    await page.goto('/');
    /* 面板与地图页共用 `['/api/v1/graph']` 这一条缓存键 —— 这个用例顺便钉住
       「面板没有偷偷再拉一份裁剪过的图谱」。 */
    const graph = page.waitForResponse(
      (response) => response.url().includes('/api/v1/graph') && response.status() === 200,
      { timeout: READY },
    );
    await openPalette(page);
    const payload = (await (await graph).json()) as { nodes: unknown[] };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ graphNodes: payload.nodes.length }));
    expect(payload.nodes.length).toBeGreaterThan(3000);

    await search(page, '的');
    const total = Number(await page.locator('.sm-palette__list').getAttribute('data-palette-total'));
    expect(total).toBeGreaterThan(900);
  });
});
