import { test, expect } from '@playwright/test';

/**
 * 票 01 的最小闭环：页面能打开、能看到后端真实数据、能点进详情。
 *
 * 断言对象是**数据本身**（知识点名字、百分比），不是「页面上有某个 class」。
 * class 名会被重构改掉，数据不会。
 *
 * 但断言也不能钉死某条具体数据 —— 实测教训：票 02 导入 215 个真实知识点后，
 * 看板上一屏放不下，`布尔代数基本运算`（票 01 的种子数据）被顶出首屏，
 * 四个用它的测试全红。改成断言「有卡片、卡片带中文名、点得进去」。
 */
test('看板显示后端真实知识点', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('核电子学学习工作站')).toBeVisible();

  // 知识点卡片的可访问名形如「布尔代数基本运算 未学习 证据不足」
  const cards = page.getByRole('button', { name: /未学习|已熟悉|已掌握|生疏/ });
  await expect(cards.first()).toBeVisible();
  await expect(cards.first()).toHaveAccessibleName(/[\u4e00-\u9fff]/);
});

test('顶栏显示数据库时间（证明后端连上了真库）', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/数据库 \d{2}:\d{2}:\d{2}/)).toBeVisible();
});

test('从看板点进知识点详情', async ({ page }) => {
  await page.goto('/');
  const first = page.getByRole('button', { name: /未学习|已熟悉|已掌握|生疏/ }).first();
  await expect(first).toBeVisible();
  const name = (await first.getAttribute('aria-label')) ?? '';
  const nodeName = name.split('，')[0]!;

  await first.click();
  await expect(page).toHaveURL(/\/map\/.+/);
  // 详情页必须显示同一知识点的名字 —— 点进去看到的不该是别的东西
  await expect(page.getByRole('heading', { name: nodeName })).toBeVisible();
});

test('证据不足的知识点显示「证据不足」而不是 0%', async ({ page }) => {
  await page.goto('/map');
  const unseen = page.getByRole('button', { name: /未学习/ }).first();
  await expect(unseen).toBeVisible();
  await unseen.click();
  await expect(page.getByText('证据不足').first()).toBeVisible();
  // 关键：不能把「没有证据」显示成 0%
  await expect(page.getByText(/^0%$/)).toHaveCount(0);
});

test('知识地图页列出叶节点', async ({ page }) => {
  await page.goto('/map');
  await expect(page.getByRole('button', { name: /未学习|已熟悉|已掌握|生疏/ }).first()).toBeVisible();
  await expect(page.getByText('已熟悉').first()).toBeVisible();
});

test('六个页面路由都能打开，占位页说明「将来干什么」而不是「建设中」', async ({ page }) => {
  await page.goto('/database');
  await expect(page.getByRole('heading', { name: '数据库' })).toBeVisible();
  // 票 02 之后数据库页是真的有数据了，不再是占位页
  await expect(page.getByText('来源追溯', { exact: true })).toBeVisible();

  await page.goto('/skills');
  await expect(page.getByRole('heading', { name: '技能库' })).toBeVisible();

  await page.goto('/level/lv-bool-1');
  await expect(page.getByRole('heading', { name: '关卡' })).toBeVisible();
  await expect(page.getByText(/票 04/)).toBeVisible();
});

test('顶栏导航能切换到数据库页', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: '数据库' }).click();
  await expect(page).toHaveURL(/\/database/);
});

/**
 * 布局缺陷只能在这里抓 —— jsdom 没有真实布局，测不到元素重叠。
 *
 * 实测踩过的缺陷：Fluent `Button` 默认是固定高度（medium = 32px），知识点名
 * 一长就换行，文字溢出按钮外，与下一个按钮的字叠在一起。截图里肉眼可见，
 * 单元测试全绿。
 */
test('知识点按钮不重叠：每个按钮的矩形都不与邻按钮相交', async ({ page }) => {
  await page.goto('/database');
  const buttons = page.locator('button').filter({ hasText: '数字' });
  await expect(buttons.first()).toBeVisible();

  const boxes = await buttons.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, text: el.textContent ?? '' };
    }),
  );
  expect(boxes.length).toBeGreaterThan(1);

  // 按 top 排序后，任意相邻两个按钮的矩形不得相交
  const sorted = [...boxes].sort((a, b) => a.top - b.top);
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    expect(
      cur.top,
      `按钮「${prev.text}」下缘 ${prev.bottom} 越过了「${cur.text}」上缘 ${cur.top}`,
    ).toBeGreaterThanOrEqual(prev.bottom - 0.5);
  }
});

test('知识点按钮的文字没有溢出自己的盒子', async ({ page }) => {
  await page.goto('/database');
  const buttons = page.locator('button').filter({ hasText: '数字' });
  await expect(buttons.first()).toBeVisible();

  const overflow = await buttons.evaluateAll((els) =>
    els
      .map((el) => ({
        text: el.textContent ?? '',
        buttonHeight: el.getBoundingClientRect().height,
        contentHeight: el.scrollHeight,
      }))
      .filter((x) => x.contentHeight > x.buttonHeight + 1),
  );
  expect(overflow).toEqual([]);
});
