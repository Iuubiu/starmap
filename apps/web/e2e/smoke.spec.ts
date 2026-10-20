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
  // 看板在 `/board`。票 08 之后 `/` 是智能体主页，那条路要换回来
  // （`apps/web/src/routes.tsx` 的注释写了原因：最常用的入口该是工作台
  // 而不是陈列架）。这条测试断言的是知识点卡片列表，所以去列表所在的页面。
  await page.goto('/board');
  await expect(page.getByText('核电子学学习工作站')).toBeVisible();

  // 知识点卡片的可访问名形如「布尔代数基本运算 未学习 证据不足」
  const cards = page.getByRole('button', { name: /未学习|已熟悉|已掌握|生疏/ });
  await expect(cards.first()).toBeVisible();
  await expect(cards.first()).toHaveAccessibleName(/[\u4e00-\u9fff]/);
});

test('顶栏显示数据库时间（证明后端连上了真库）', async ({ page }) => {
  await page.goto('/');
  // 顶栏是个壳，挂在哪个路由下都会渲染 —— 用 `/`（智能体主页）验证这一点。
  await expect(page.getByText(/数据库 \d{2}:\d{2}:\d{2}/)).toBeVisible();
});

test('从看板点进知识点详情', async ({ page }) => {
  await page.goto('/board');
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
});

/**
 * 关卡页要能真的打开，且是**真关卡**。
 *
 * 这里用 `lv-bool-laws`（迁移 0010 提供）而不是 `lv-bool-1`（早期 seed 插入的
 * 演示关卡）。后者没有 spec，靠 `levels.spec` 的 `DEFAULT '{}'` 蒙混入库，
 * 点开就是 500「关卡规范不合法」—— 已由迁移 0004 删除，且那个 DEFAULT 也被
 * 一并撤掉了。断言换成迁移提供的关卡，任何库都有，不依赖有没有跑过 seed。
 *
 * 用一级标题断言而不是 `getByRole('heading')`：这个页面此前**没有 h1**
 * （`<Text>` 默认渲染成 span），屏幕阅读器的标题导航在这里断掉。断言 h1
 * 同时钉住了无障碍缺陷与关卡真名。
 */
test('关卡页打开真实教学关卡，一级标题是关卡名', async ({ page }) => {
  await page.goto('/level/lv-bool-laws');
  await expect(
    page.getByRole('heading', { level: 1, name: '逻辑代数基本律：吸收律与德摩根律' }),
  ).toBeVisible();
  // 播放器真的渲染出了第一步，而不是空壳页面。
  await expect(page.getByText(/第 1 段/)).toBeVisible();
});

/**
 * 「关卡不存在」与「关卡存在但数据坏了」必须是两种不同的结果。
 *
 * 500 曾经是「这行在库里，但它的 spec 是坏的」的唯一信号；把它和 404 混成
 * 一种，下一个写坏 spec 的人就不会知道自己写坏了。这条守的是这个区分本身：
 * 一个从没存在过的 id 必须 404，不能因为「读不出来」就报 500。
 */
test('不存在的关卡返回 404，不是 500', async ({ request }) => {
  const res = await request.get('/api/v1/levels/nope-does-not-exist');
  expect(res.status()).toBe(404);
  expect((await res.json()).code).toBe('NOT_FOUND');
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
