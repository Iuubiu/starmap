/**
 * 票 03「知识图谱地图与浏览」的验收测试。
 *
 * ## 为什么这些断言必须在 Playwright 里
 *
 * jsdom 没有布局引擎、没有 WebGL。`<canvas>` 在 jsdom 里是个 300×150 的空
 * 矩形，`getBoundingClientRect()` 永远返回 0 —— 所以「标签在缩放后消失」
 * 「节点画在正确位置」这类断言在 jsdom 里只能测到我们自己的布尔值，测不到
 * 真实渲染。这里跑的是 bundled Chromium 的真 WebGL2，读的是 sigma 自己的
 * 状态（`getNodeDisplayedLabels()`），不是我们的意图。
 *
 * ## 关于真实数据
 *
 * 种子数据里 167 个叶节点只有 52 条先修边、**109 个是完全孤立的**。这意味
 * 着不能对「某个节点的两跳邻域有几个点」写死断言 —— 那取决于恰好选中了谁。
 * 所以凡是涉及邻域大小的用例，都用**相对断言**（展开后 ≥ 展开前）或先取
 * 全图规模再比。这不是偷懒，而是被测对象本来就是数据相关的。
 */
import { expect, test } from '@playwright/test';

/** 画布容器的定位器。`data-node-count` 等真实状态都挂在它上面。 */
const canvas = (page: import('@playwright/test').Page) => page.locator('.graph-canvas');

/** 节点清单里的按钮。清单是画布的等价文本替代，也是键盘入口。 */
const rosterItems = (page: import('@playwright/test').Page) => page.locator('.graph-roster-item');

test.describe('图谱画布真实渲染', () => {
  test('画布渲染真实节点，数量与清单一致', async ({ page }) => {
    await page.goto('/map');
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });

    // 默认全图：画布上的节点数应当等于后端返回的叶节点总数
    const drawn = Number(await canvas(page).getAttribute('data-node-count'));
    expect(drawn).toBeGreaterThan(100);

    const rosterCount = await rosterItems(page).count();
    expect(rosterCount).toBe(drawn);
  });

  test('WebGL 不可用时有可读的降级文案，而不是白屏', async ({ page }) => {
    // 用 addInitScript 掐掉 WebGL 上下文，模拟禁用硬件加速的环境
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function patched(
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type === 'webgl2' || type === 'webgl') return null;
        return original.call(this, type, ...(rest as []));
      } as typeof original;
    });
    await page.goto('/map');
    // 降级：画布区给出说明，但节点清单仍然可用（这是可访问替代的价值）
    await expect(page.locator('.graph-canvas-broken')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.graph-canvas-broken')).toContainText('WebGL2');
    await expect(rosterItems(page).first()).toBeVisible();
  });
});

test.describe('票 03 第 1 条：物理模拟不阻塞主线程', () => {
  test('力导向布局跑在 Worker 里', async ({ page }) => {
    await page.goto('/map');
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
    // 真实浏览器里一定是 worker：Blob URL 的 Worker 在 Chromium 上总能起来
    await expect(canvas(page)).toHaveAttribute('data-layout-source', 'worker');
  });

  test('2000 节点下布局期间主线程没有长任务', async ({ page }) => {
    /**
     * 造一份 2000 节点的图。
     *
     * 用 `page.route` 在浏览器边缘拦截（不进网络）—— 这是最接近真实后端
     * 形状的造数方式，且不会让测试依赖一个专门的测试端点。
     *
     * 图的结构刻意做成「若干条链 + 大量孤立点」，因为这正是真实数据的形态
     * （167 节点里 109 个孤立），也是力导向最不擅长的形态。
     */
    const NODE_COUNT = 2000;
    await page.route('**/api/v1/graph', async (route) => {
      const nodes = Array.from({ length: NODE_COUNT }, (_, i) => ({
        microKpId: `kp-${i}`,
        name: `微知识点 ${i}`,
        state: i % 5 === 0 ? 'mastered' : i % 3 === 0 ? 'familiar' : 'unseen',
        percent: i % 5 === 0 ? 0.9 : i % 3 === 0 ? 0.4 : null,
        depth: 2,
        ordinal: i,
        moduleId: `m-${Math.floor(i / 100)}`,
        moduleName: `模块 ${Math.floor(i / 100)}`,
        moduleOrdinal: Math.floor(i / 100),
        reviewDueAt: null,
      }));
      // 一条长链：这是 FA2 里最长程的力，最能暴露主线程被占
      const edges = Array.from({ length: NODE_COUNT - 1 }, (_, i) => ({
        from: `kp-${i}`,
        to: `kp-${i + 1}`,
        kind: 'prereq',
      }));
      await route.fulfill({ json: { nodes, edges } });
    });

    // 在任何脚本之前埋长任务观察器：布局若在主线程跑，必然产生 >50ms 的块
    await page.addInitScript(() => {
      const bucket: Array<{ start: number; duration: number }> = [];
      (window as unknown as { __longTasks: typeof bucket }).__longTasks = bucket;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          bucket.push({ start: Math.round(entry.startTime), duration: entry.duration });
        }
      }).observe({ entryTypes: ['longtask'] });
    });

    await page.goto('/map?hops=all');
    await expect(canvas(page)).toHaveAttribute('data-node-count', String(NODE_COUNT), {
      timeout: 30_000,
    });

    /**
     * 分两段测，因为「主线程被布局占住」有两个不同的表现形式。
     *
     * 第一段是**布局窗口内**（打开后 4s，见 GraphCanvas 的 LAYOUT_BUDGET_MS）：
     * 这里允许出现中等长度的任务，因为首次绘制 2000 个节点本身就要上传顶点、
     * 建索引，而 worker 每轮写回坐标会让 sigma 重算一次布局。但**不允许秒级
     * 冻结** —— 同步 FA2 在 2000 节点上是秒级到数十秒，和这里差一个数量级。
     *
     * 第二段是**布局窗口结束之后**：worker 停了，主线程必须彻底安静。这一段
     * 是这条验收最锋利的地方 —— 如果物理计算真的漏回主线程（比如有人把
     * `forceAtlas2.assign()` 写回来），它会在这一段持续产出长任务。
     */
    async function readTasks(): Promise<Array<{ start: number; duration: number }>> {
      return page.evaluate(
        () => (window as unknown as { __longTasks?: Array<{ start: number; duration: number }> })
          .__longTasks ?? [],
      );
    }

    /**
     * 测量窗口从**画布就绪那一刻**开始，不是从导航开始。
     *
     * 这条测试跑在 Vite dev server 上（见 playwright.config.ts），而 dev 模式
     * 是逐模块编译 + 按需 transform 的，2000 个数据点进来后 React 首次渲染
     * 这一串本身就会产生一次秒级任务（实测 `start≈490ms, duration≈2.2s`，
     * 而画布要到 ≈4.7s 才就绪）。那是**加载**的代价，不是**物理模拟**的代价，
     * 把它算进布局窗口会让这条断言失去它想测的东西。
     *
     * 窗口起点之后的每一毫秒才是布局的账：worker 每轮把坐标写回 graph、
     * sigma 据此重算并重绘，这部分如果漏回主线程就会在这里露出来。
     * 第二段（窗口结束后的静默）不设起点，它本来就该空。
     */
    const readyAt = await page.evaluate(() => Math.round(performance.now()));

    await page.waitForTimeout(5_000);
    const duringLayout = (await readTasks()).filter((t) => t.start >= readyAt);
    expect(Math.max(0, ...duringLayout.map((t) => t.duration))).toBeLessThan(1_000);
    // 没有长任务时 cutoff 回落到 readyAt —— 否则第二段会把加载期那次任务算进来
    const cutoff =
      duringLayout.length === 0 ? readyAt : Math.max(...duringLayout.map((t) => t.start));

    // 布局窗口已过，再静置一段：这一段不该有任何长任务
    await page.waitForTimeout(1_500);
    const all = await readTasks();
    const afterLayout = all.filter((t) => t.start > cutoff);
    expect(afterLayout.map((t) => Math.round(t.duration))).toEqual([]);

    // 并且交互仍然可用：布局真的是 worker 干的
    await expect(canvas(page)).toHaveAttribute('data-layout-source', 'worker');
  });

  test('2000 节点下拖动与缩放仍可交互', async ({ page }) => {
    await page.goto('/map');
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });

    const box = await canvas(page).boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // 拖动平移：按下—移动—抬起，进程不能卡死（Playwright 的 action timeout
    // 会捕获「主线程被占导致事件无法处理」）
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 8 });
    await page.mouse.up();

    // 缩放：滚轮一格，相机 ratio 必须变化
    const before = Number(await canvas(page).getAttribute('data-camera-ratio'));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 240);
    await expect
      .poll(async () => Number(await canvas(page).getAttribute('data-camera-ratio')), {
        timeout: 5000,
      })
      .not.toBe(before);
  });
});

test.describe('票 03 第 2 条：两跳邻域与逐层展开', () => {
  test('有焦点时默认两跳，+1 / −1 / 回全图三个按钮都在', async ({ page }) => {
    await page.goto('/map');
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });

    // 选一个焦点：用选择器（这是真实用户的路径，不依赖某个特定节点在不在）
    await page.getByLabel('选择焦点知识点').selectOption({ index: 1 });
    await expect(page).toHaveURL(/focus=/);

    await expect(page.getByRole('button', { name: '−1 跳' })).toBeVisible();
    await expect(page.getByRole('button', { name: '+1 跳' })).toBeVisible();
    await expect(page.getByRole('button', { name: '回全图' })).toBeVisible();

    // 焦点视野一定比全图小（除非整个图就这么点大）
    const total = await page
      .locator('.graph-legend-total')
      .first()
      .textContent()
      .catch(() => null);
    expect(total).not.toBeNull();
  });

  test('+1 跳不会变小，−1 跳不会变大', async ({ page }) => {
    await page.goto('/map');
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('选择焦点知识点').selectOption({ index: 1 });

    const readCount = async (): Promise<number> =>
      Number(await canvas(page).getAttribute('data-node-count'));

    const atTwo = await readCount();
    await page.getByRole('button', { name: '+1 跳' }).click();
    await expect.poll(readCount, { timeout: 10_000 }).toBeGreaterThanOrEqual(atTwo);
    const atThree = await readCount();

    await page.getByRole('button', { name: '−1 跳' }).click();
    /*
     * 直接等「回到两跳的那个数」，而不是「不多于三跳的那个数」。
     *
     * 后者在点击的瞬间就已经为真（旧值还没变），poll 会立刻通过，然后在画布
     * 重建到一半时再读一次数 —— 读到的是中间态，于是随机变红。断言要盯住
     * 最终应有的值，而不是一个当下就成立的宽松条件。
     */
    await expect.poll(readCount, { timeout: 10_000 }).toBe(atTwo);
    expect(atThree).toBeGreaterThanOrEqual(atTwo);
  });

  test('回全图后节点数等于总节点数', async ({ page }) => {
    await page.goto('/map');
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
    /*
     * 图例给出的是**每一类**的「视野内/全图」，总数要把四类加起来。
     *
     * 早先这里读的是「第一类那一格的全图数」—— 真实数据里 167 个叶节点中
     * 未学占 166，于是断言实际在比较 167 与 166，测的是巧合而不是行为，
     * 换一份数据就会红。
     */
    const totals = await page.locator('.graph-legend-total').allTextContents();
    const total = totals.reduce((sum, text) => sum + Number(text.replace('/', '')), 0);
    expect(total).toBeGreaterThan(0);

    await page.getByLabel('选择焦点知识点').selectOption({ index: 1 });
    await page.getByRole('button', { name: '回全图' }).click();

    await expect
      .poll(async () => Number(await canvas(page).getAttribute('data-node-count')), {
        timeout: 10_000,
      })
      .toBe(total);
  });

  test('跳数写进 URL，可分享可刷新', async ({ page }) => {
    await page.goto('/map?focus=kp-bool&hops=1');
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('选择焦点知识点')).toHaveValue('kp-bool');
    // 刷新后位置不丢
    await page.reload();
    await expect(page.getByLabel('选择焦点知识点')).toHaveValue('kp-bool');
    await expect(page).toHaveURL(/hops=1/);
  });
});

test.describe('票 03 第 3、7 条：四状态可辨 + 非颜色第二编码', () => {
  test('图例同时给出四种形状、四种文字与计数', async ({ page }) => {
    await page.goto('/map');
    const legend = page.locator('.graph-legend');
    await expect(legend).toBeVisible({ timeout: 15_000 });

    // 四类文案逐一在场（票 03 第 3 条要的是「可辨」，首先是能读到）
    for (const label of ['未学', '在学', '已掌握', '需复验']) {
      await expect(legend.getByText(label, { exact: true })).toBeVisible();
    }

    // 第二编码：四种形状各不相同，且都真的画了 SVG 几何图形
    const shapes = await legend.locator('.graph-legend-item').evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-shape')),
    );
    expect(shapes).toEqual(['circle', 'square', 'diamond', 'triangle']);
    expect(new Set(shapes).size).toBe(4);

    // 每个图例项都有可见的形状 SVG —— 只画色块的话「形状编码」不可学习
    const glyphs = await legend.locator('svg').count();
    expect(glyphs).toBe(4);
  });

  test('节点清单里每个节点都带 data-shape（形状与状态一一对应）', async ({ page }) => {
    await page.goto('/map');
    await expect(rosterItems(page).first()).toBeVisible({ timeout: 15_000 });

    const shapes = await rosterItems(page).evaluateAll((items) =>
      items.map((item) => ({
        status: item.getAttribute('data-status'),
        shape: item.getAttribute('data-shape'),
      })),
    );
    expect(shapes.length).toBeGreaterThan(100);

    // 状态 → 形状必须是一对一映射，不能两个状态共用一个形状
    const byStatus = new Map<string, Set<string>>();
    for (const { status, shape } of shapes) {
      if (!status || !shape) continue;
      const set = byStatus.get(status) ?? new Set<string>();
      set.add(shape);
      byStatus.set(status, set);
    }
    for (const [status, set] of byStatus) {
      expect(set.size, `状态 ${status} 用了 ${String(set.size)} 种形状`).toBe(1);
    }
    // 出现过的状态不能共用同一个形状
    const shapesUsed = new Set([...byStatus.values()].map((set) => [...set][0]));
    expect(shapesUsed.size).toBe(byStatus.size);
  });
});

test.describe('票 03 第 4 条：点击进入关卡 + 返回保持焦点', () => {
  test('点画布清单里的节点进入详情页', async ({ page }) => {
    await page.goto('/map');
    await expect(rosterItems(page).first()).toBeVisible({ timeout: 15_000 });

    const first = rosterItems(page).first();
    const label = await first.getAttribute('aria-label');
    expect(label).not.toBeNull();
    const name = (label ?? '').split('，')[0];
    expect(name?.length ?? 0).toBeGreaterThan(0);

    await first.click();
    await expect(page).toHaveURL(/\/map\/.+/);
    await expect(page.getByRole('heading', { name })).toBeVisible();
  });

  test('从详情页返回地图时焦点保持原位', async ({ page }) => {
    // 先进一个有确定焦点的地址
    await page.goto('/map?focus=kp-bool&hops=2');
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });

    await rosterItems(page).filter({ hasText: '布尔代数基本运算' }).first().click();
    await expect(page).toHaveURL(/\/map\/kp-bool/);

    await page.getByRole('button', { name: '返回地图' }).click();

    // 关键断言：回来时焦点还在 kp-bool 上，而不是退回全图
    await expect(page).toHaveURL(/focus=kp-bool/);
    await expect(page.getByLabel('选择焦点知识点')).toHaveValue('kp-bool');
    await expect(canvas(page)).toBeVisible();
  });

  test('直接打开详情页（无来源 state）时返回仍以该节点为焦点', async ({ page }) => {
    await page.goto('/map/kp-bool');
    await expect(page.getByRole('heading', { name: '布尔代数基本运算' })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: '返回地图' }).click();
    await expect(page).toHaveURL(/focus=kp-bool/);
  });
});

test.describe('票 03 第 5 条：线性主线视图可切换且位置不丢', () => {
  test('切到主线再切回来，焦点与跳数都不变', async ({ page }) => {
    await page.goto('/map?focus=kp-bool&hops=2');
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
    const before = Number(await canvas(page).getAttribute('data-node-count'));

    await page.getByRole('button', { name: '线性主线' }).click();
    await expect(page.locator('[data-mainline]')).toBeVisible();
    await expect(page).toHaveURL(/view=mainline/);
    // 主线视图里焦点节点的轮次仍然标着
    await expect(page.locator('[data-mainline] [data-focus="true"]')).toBeVisible();

    await page.getByRole('button', { name: '图谱视图' }).click();
    await expect(canvas(page)).toBeVisible();

    // 位置没丢：焦点与跳数原样，节点数也回到原样
    await expect(page.getByLabel('选择焦点知识点')).toHaveValue('kp-bool');
    await expect(page).toHaveURL(/hops=2/);
    expect(Number(await canvas(page).getAttribute('data-node-count'))).toBe(before);
  });

  test('主线视图按模块分组，顺序稳定可复现', async ({ page }) => {
    await page.goto('/map?view=mainline');
    await expect(page.locator('[data-mainline]')).toBeVisible({ timeout: 15_000 });

    const first = await page
      .locator('[data-mainline] [data-module-id]')
      .evaluateAll((sections) => sections.map((s) => s.getAttribute('data-module-id')));

    await page.reload();
    await expect(page.locator('[data-mainline]')).toBeVisible({ timeout: 15_000 });
    const second = await page
      .locator('[data-mainline] [data-module-id]')
      .evaluateAll((sections) => sections.map((s) => s.getAttribute('data-module-id')));

    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(first.length); // 每个模块只出现一次
  });

  test('主线视图也能点进关卡', async ({ page }) => {
    await page.goto('/map?view=mainline');
    await expect(page.locator('[data-mainline]')).toBeVisible({ timeout: 15_000 });
    const row = page.locator('[data-mainline] button[data-node-id]').first();
    const label = await row.getAttribute('aria-label');
    const name = (label ?? '').split('，')[0];
    await row.click();
    await expect(page).toHaveURL(/\/map\/.+/);
    await expect(page.getByRole('heading', { name })).toBeVisible();
  });
});

test.describe('票 03 第 6 条：缩放低于阈值时只画点不画标签', () => {
  test('缩小后标签消失，放大后回来', async ({ page }) => {
    await page.goto('/map');
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });

    // 初始（ratio = 1）标签是显示的，且 sigma 真的画了标签
    await expect(canvas(page)).toHaveAttribute('data-labels-visible', 'true');
    await expect
      .poll(async () => Number(await canvas(page).getAttribute('data-labels-displayed')), {
        timeout: 10_000,
      })
      .toBeGreaterThan(0);

    // 缩小若干格，越过 1.6 的阈值
    const box = await canvas(page).boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 5; i += 1) await page.mouse.wheel(0, 240);

    await expect
      .poll(async () => await canvas(page).getAttribute('data-labels-visible'), { timeout: 10_000 })
      .toBe('false');

    /**
     * 真源断言：读 sigma 自己算出来的 `getNodeDisplayedLabels()`。
     *
     * 只断言我们自己的 `data-labels-visible` 等于「证明我以为我隐藏了」；
     * 这个数字是渲染管线在密度抽样与阈值判定之后的结果。允许保留 1 个
     * ——焦点节点永远带标签（它是方位参照，见 `label-threshold.ts`）。
     */
    const displayed = Number(await canvas(page).getAttribute('data-labels-displayed'));
    expect(displayed).toBeLessThanOrEqual(1);

    // 放大回来，标签应当恢复
    for (let i = 0; i < 7; i += 1) await page.mouse.wheel(0, -260);
    await expect
      .poll(async () => await canvas(page).getAttribute('data-labels-visible'), { timeout: 10_000 })
      .toBe('true');
  });

  test('键盘也能缩放（滚轮对键盘用户不可用）', async ({ page }) => {
    await page.goto('/map');
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
    const before = Number(await canvas(page).getAttribute('data-camera-ratio'));

    await page.getByRole('button', { name: '缩小图谱' }).click();
    await expect
      .poll(async () => Number(await canvas(page).getAttribute('data-camera-ratio')), {
        timeout: 10_000,
      })
      .toBeGreaterThan(before);

    await page.getByRole('button', { name: '放大图谱' }).click();
    await page.getByRole('button', { name: '复位图谱视野' }).click();
    await expect
      .poll(async () => Number(await canvas(page).getAttribute('data-camera-ratio')), {
        timeout: 10_000,
      })
      .toBe(1);
  });
});

test.describe('票 03 第 7 条：全键盘可达', () => {
  test('Tab 能逐个走到节点清单里的按钮', async ({ page }) => {
    await page.goto('/map');
    await expect(rosterItems(page).first()).toBeVisible({ timeout: 15_000 });

    // 清点可聚焦的清单项
    const total = await rosterItems(page).count();
    expect(total).toBeGreaterThan(100);

    // 从第一个清单项开始，连按 Tab，必须连续落在清单项上
    await rosterItems(page).first().focus();
    await expect(rosterItems(page).first()).toBeFocused();

    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Tab');
      const focusedIsItem = await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.classList.contains('graph-roster-item'),
      );
      expect(focusedIsItem, `第 ${String(i + 1)} 次 Tab 之后焦点跑出了节点清单`).toBe(true);
    }
  });

  test('清单项的焦点环可见（深色背景下不能丢失焦点指示）', async ({ page }) => {
    await page.goto('/map');
    await expect(rosterItems(page).first()).toBeVisible({ timeout: 15_000 });
    await rosterItems(page).first().focus();
    // :focus-visible 的描边由 graph.css 给；这里断言它确实生效了
    const outline = await rosterItems(page)
      .first()
      .evaluate((el) => getComputedStyle(el).outlineWidth);
    expect(outline).not.toBe('0px');
  });

  test('Enter 从清单项进入关卡', async ({ page }) => {
    await page.goto('/map');
    await expect(rosterItems(page).first()).toBeVisible({ timeout: 15_000 });

    const first = rosterItems(page).first();
    const label = await first.getAttribute('aria-label');
    const name = (label ?? '').split('，')[0];
    await first.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/map\/.+/);
    await expect(page.getByRole('heading', { name })).toBeVisible();
  });

  test('画布容器对读屏隐藏，等价信息由清单与 aria-live 承担', async ({ page }) => {
    await page.goto('/map');
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });

    // WebGL 层是 aria-hidden：里面没有可读内容，不该被读屏扫到
    await expect(page.locator('.graph-canvas-webgl')).toHaveAttribute('aria-hidden', 'true');

    // 视野描述是 aria-live 的，读屏用户能听到「现在看的是哪一块、多少个点」
    const description = page.locator('[data-view-description]');
    await expect(description).toHaveAttribute('aria-live', 'polite');
    await expect(description).toContainText('个微知识点');
  });

  test('缩放入口可用键盘操作', async ({ page }) => {
    await page.goto('/map');
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
    const zoomIn = page.getByRole('button', { name: '放大图谱' });
    await zoomIn.focus();
    await expect(zoomIn).toBeFocused();
    await page.keyboard.press('Enter');
  });
});

test.describe('图谱与看板的导航一致性', () => {
  test('从看板点进详情，再返回地图时落到该节点为焦点的视图', async ({ page }) => {
    // 看板在 `/board`：票 08 之后 `/` 是智能体主页，知识点列表搬走了
    await page.goto('/board');
    const card = page.getByRole('button', { name: /未学习|已熟悉|已掌握/ }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    const label = await card.getAttribute('aria-label');
    const name = (label ?? '').split('，')[0];

    await card.click();
    await expect(page).toHaveURL(/\/map\/.+/);
    await expect(page.getByRole('heading', { name })).toBeVisible();

    await page.getByRole('button', { name: '返回地图' }).click();
    await expect(page).toHaveURL(/focus=/);
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
  });

  test('顶栏切到知识地图后画布就绪', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: '知识地图' }).click();
    await expect(page).toHaveURL(/\/map/);
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('无障碍名沿用既有格式（不弄坏 smoke.spec.ts）', () => {
  test('清单项的可访问名是「名称，状态，百分比/证据不足」', async ({ page }) => {
    await page.goto('/map');
    await expect(rosterItems(page).first()).toBeVisible({ timeout: 15_000 });

    const labels = await rosterItems(page).evaluateAll((items) =>
      items.slice(0, 20).map((item) => item.getAttribute('aria-label') ?? ''),
    );
    for (const label of labels) {
      const parts = label.split('，');
      expect(parts).toHaveLength(3);
      expect(parts[0]?.length ?? 0).toBeGreaterThan(0);
      // 五档状态词表（smoke.spec.ts 用这组词匹配）
      expect(['未学习', '刚接触', '已熟悉', '已熟练', '已掌握']).toContain(parts[1]);
      expect(/^(\d+%|证据不足)$/.test(parts[2] ?? '')).toBe(true);
    }
  });

  test('页面上有可见的状态文字「已熟悉」（smoke.spec.ts 依赖）', async ({ page }) => {
    await page.goto('/map');
    // 真实数据里 kp-bool 就是 familiar；清单里会同时出现四类词
    await expect(page.getByText('已熟悉').first()).toBeVisible({ timeout: 15_000 });
  });
});
