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
 *
 * ## 并行泳道下不稳定：跑它要独占 checkout
 *
 * 这个文件在**多人共用同一个 checkout** 时会假红。2026-10-22 实测（票 t73）：
 * 5 次串行 `--workers=1` 连跑，4 次 `28 passed`、1 次 `4 failed` —— 四条红
 * 全部落在同一次 run，且每个失败目录的 `error-context.md` 里都是
 * `[plugin:vite:oxc] Transform failed ... PARSE_ERROR`，指向当时另一个泳道
 * 正在写的 `src/theme/tokens.ts`。也就是说：**红的原因不是被测代码，而是
 * 共用的 vite dev server 按需 transform 到了别人正在编辑的源文件**。
 *
 * 同一次实验里并发双泳道（两个 Playwright 进程同时跑同一份 spec，共用
 * 3001 真实库 + 5173 dev server）跑 4 次全部 `28 passed` —— 所以「抢 CPU /
 * 抢数据库」本身不产生假红，写源文件的竞态才会。
 *
 * 做法：
 * - 跑这个文件时独占 checkout，或至少确认没人在改 `apps/web/src/**`；
 * - CI 里天然独占；`--workers=1` 只是让失败可复现，不是稳定性开关；
 * - **不引入 retry**：retry 会把「别人把源文件写坏了」这条真信息盖掉。
 */

import { expect, test } from '@playwright/test';

/**
 * 页面就绪预算：`/map` 每次都要拉回 1789 个叶节点（466 KB）再交给 sigma
 * 建 WebGL 画布，本机无 GPU 走 SwiftShader，实测冷加载 5.7 秒起。
 *
 * 为什么不是 15 秒：单独跑一条用例时 15 秒够用，但 `graph.spec.ts` +
 * `smoke.spec.ts` 连跑 40 条、持续 5–6 分钟之后，机器负载会把冷加载推到
 * 20 秒以上，于是红在「`.graph-canvas` not found」——报错看起来像画布没
 * 渲染出来，实际上只是还没到。这类红与票 03 的任何验收条款都无关，只会
 * 训练人忽略红色。所以统一用 60 秒预算：它不会掩盖真实的功能缺陷（真坏
 * 了是永远不出现，不是 60 秒后才出现），只是不再把机器慢当成产品坏。
 *
 * 单条用例内部那些「动作之后等状态翻面」的 `expect.poll` 仍是 10 秒 ——
 * 那些等的是渲染管线的下一帧，不该跟着页面加载一起放宽。
 */
const READY = 60_000;

/**
 * 单条用例的总预算。Playwright 默认 30 秒，比上面的 `READY` 还短 ——
 * 不抬这一层，`toBeVisible({ timeout: READY })` 会先被用例的 30 秒砍掉，
 * 上面那段注释就成了空话。这里不能只靠 `test.slow()`：slow 只给被标记
 * 的那几条，而慢加载是每条 `/map` 用例共有的。
 */
test.describe.configure({ timeout: 120_000 });

/** 画布容器的定位器。`data-node-count` 等真实状态都挂在它上面。 */
const canvas = (page: import('@playwright/test').Page) => page.locator('.graph-canvas');

/** 节点清单里的按钮。清单是画布的等价文本替代，也是键盘入口。 */
const rosterItems = (page: import('@playwright/test').Page) => page.locator('.graph-roster-item');

/**
 * 等画布进入「真的有节点可读」的状态 —— 用真实信号，不用时长。
 *
 * 为什么不只等 `.graph-canvas` 可见：画布容器在数据到位之前就可能挂上
 * （`GraphCanvas` 对空数组也渲染），所以「可见」只证明组件挂载了，不证明
 * 图已经来了。`data-node-count` 是画布从 props 直接渲染出的真实数字，
 * 它 > 0 才是「可以开始读图」。
 *
 * 为什么不用固定 `waitForTimeout`：那在快机器上是浪费、在慢机器上仍然
 * 不够，且失败时报的是「后面那条断言」，看不出是没等到。
 *
 * 预算仍是文件级的 `READY`（60 秒），没有抬高：本函数只是把「等到什么」
 * 从时长换成了状态，慢机器照样等得起，真坏掉的页面则永远等不到 —— 该红。
 */
async function waitForGraph(page: import('@playwright/test').Page): Promise<void> {
  await expect(canvas(page)).toBeVisible({ timeout: READY });
  await expect
    .poll(async () => Number((await canvas(page).getAttribute('data-node-count')) ?? 0), {
      timeout: READY,
      intervals: [100, 250, 500, 1_000],
    })
    .toBeGreaterThan(0);
}

/**
 * 等图例渲染出四格再读计数。
 *
 * `.graph-legend-total` 是「全图各类计数」，图例没渲染时 `allTextContents()`
 * 返回空数组、累加得 0 —— 早先的写法直接 `expect(total).toBeGreaterThan(0)`，
 * 在负载下就变成「图例还没画出来」被报成「图例数据不对」。
 * 四格齐是渲染完成的真实信号（`STATUS_ORDER` 固定四项）。
 */
async function legendTotals(page: import('@playwright/test').Page): Promise<number[]> {
  await expect(page.locator('.graph-legend-total')).toHaveCount(4, { timeout: READY });
  const texts = await page.locator('.graph-legend-total').allTextContents();
  return texts.map((text) => Number(text.replace('/', '')));
}

test.describe('图谱画布真实渲染', () => {
  test('画布渲染真实节点，数量与清单一致', async ({ page }) => {
    await page.goto('/map');
    await waitForGraph(page);

    /**
     * 默认视图已改（2026-10-23）：不再画全图。
     *
     * 实测库内 3085 个叶节点只有 279 条边、其中 5129 个节点完全孤立，画全图
     * 必然是一圈密点，1440 与 2560 下都读不出结构。现在无焦点时自动落在
     * 「枢纽点」上，只渲染它的两跳邻域 —— 这是产品裁定，不是回归。
     * 因此这里断言的是「邻域非空且清单与画布一致」，不再是「等于全库叶节点数」。
     */
    const drawn = Number(await canvas(page).getAttribute('data-node-count'));
    expect(drawn).toBeGreaterThan(5);

    /**
     * 清单是分批渲染的（首批 400 条），这不是缺陷而是首屏预算。
     *
     * 2000 个按钮 ≈ 14000 个 DOM 节点，一次性挂载实测是 3.6s 的单个长任务，
     * 比同步力导向还糟 —— 恰好撞在票 03 第 1 条「拖动缩放仍可交互」上。所以
     * `NodeRoster` 默认只挂头 400 条，其余用「继续显示」按批放出。
     *
     * 这条用例要验的是「画布上的每一个点都能在清单里找到」，不是「首屏挂了
     * 多少条」。所以先把剩下的展开再数 —— 分批是性能手段，等价替代的完整性
     * 不能因此打折。数据只有 167 个叶节点时首批就装下了，这条分支不触发；
     * 真实库涨到 1789 个之后才走展开路径。
     */
    const more = page.getByRole('button', { name: /继续显示/ });
    if ((await more.count()) > 0) {
      await more.click();
    }
    await expect(rosterItems(page)).toHaveCount(drawn);
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
    await expect(page.locator('.graph-canvas-broken')).toBeVisible({ timeout: READY });
    await expect(page.locator('.graph-canvas-broken')).toContainText('WebGL2');
    await expect(rosterItems(page).first()).toBeVisible();
  });
});

test.describe('票 03 第 1 条：物理模拟不阻塞主线程', () => {
  test('力导向布局跑在 Worker 里', async ({ page }) => {
    await page.goto('/map');
    await waitForGraph(page);
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
      await route.fulfill({
        json: {
          nodes,
          edges,
          // 契约里 `recommendedIds` 是必填（票 13 验收第 5 条）。这里桩数据不
          // 假装有推荐：空数组的语义是「此刻没有可推荐的节点」，不是「功能没
          // 接通」。少了这个字段前端不会崩（可选链兜底），但桩数据不完整的
          // 话，将来真的加上「推荐徽标必须出现」的断言时会莫名其妙地红。
          recommendedIds: [],
        },
      });
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
    await waitForGraph(page);

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
    await waitForGraph(page);

    // 选一个焦点：用选择器（这是真实用户的路径，不依赖某个特定节点在不在）
    await page.getByLabel('选择焦点知识点').selectOption({ index: 1 });
    await expect(page).toHaveURL(/focus=/);

    await expect(page.getByRole('button', { name: '−1 跳' })).toBeVisible();
    await expect(page.getByRole('button', { name: '+1 跳' })).toBeVisible();
    await expect(page.getByRole('button', { name: '回全图' })).toBeVisible();

    /*
     * 图例必须已经渲染出四格。
     *
     * 早先这里是 `.locator('.graph-legend-total').first().textContent()` +
     * `expect(total).not.toBeNull()`：图例还没画出来时 `textContent()` 是
     * null，红的是「图例不存在」，报错却落在「焦点视野没生效」这条用例上。
     * 四格齐是渲染完成的真实信号（`STATUS_ORDER` 固定四项），等它比等时长准。
     */
    const totals = await legendTotals(page);
    expect(totals.length).toBe(4);
  });

  test('+1 跳不会变小，−1 跳不会变大', async ({ page }) => {
    await page.goto('/map');
    await waitForGraph(page);
    await page.getByLabel('选择焦点知识点').selectOption({ index: 1 });

    const readCount = async (): Promise<number> =>
      Number(await canvas(page).getAttribute('data-node-count'));

    /**
     * 取基线前先等计数稳定。
     *
     * 原先是选完焦点立刻读 —— 而 `selectOption` 只保证 change 事件发出去，
     * 焦点视图的重建是异步的。整套 e2e 一起跑时（前面的用例把机器焐热了）
     * 这里会读到**重建前**的全图节点数，基线被记成 167；接着 `+1 跳` 得到
     * 几十个节点，`toBeGreaterThanOrEqual(167)` 当然不成立，于是随机变红。
     * 单独跑这条则总是绿 —— 典型的时序抖动，不是实现有问题。
     *
     * 判据是「连续两次读数相同」：重建到一半时值还在跳，稳定了才取样。
     */
    const settledCount = async (): Promise<number> => {
      let previous = -1;
      await expect
        .poll(
          async () => {
            const current = await readCount();
            const stable = current === previous;
            previous = current;
            return stable;
          },
          { timeout: 10_000, intervals: [120] },
        )
        .toBe(true);
      return previous;
    };

    const atTwo = await settledCount();
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
    await waitForGraph(page);
    /*
     * 图例给出的是**每一类**的「视野内/全图」，总数要把四类加起来。
     *
     * 早先这里读的是「第一类那一格的全图数」—— 真实数据里 167 个叶节点中
     * 未学占 166，于是断言实际在比较 167 与 166，测的是巧合而不是行为，
     * 换一份数据就会红。
     */
    const totals = await legendTotals(page);
    const total = totals.reduce((sum, value) => sum + value, 0);
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
    await waitForGraph(page);
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
    await expect(legend).toBeVisible({ timeout: READY });

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
    await expect(rosterItems(page).first()).toBeVisible({ timeout: READY });

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
    await expect(rosterItems(page).first()).toBeVisible({ timeout: READY });

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
    await waitForGraph(page);

    await rosterItems(page).filter({ hasText: '布尔代数基本运算' }).first().click();
    await expect(page).toHaveURL(/\/map\/kp-bool/);

    await page.getByRole('button', { name: '返回地图' }).click();

    // 关键断言：回来时焦点还在 kp-bool 上，而不是退回全图
    await expect(page).toHaveURL(/focus=kp-bool/);
    await expect(page.getByLabel('选择焦点知识点')).toHaveValue('kp-bool');
    await waitForGraph(page);
  });

  test('直接打开详情页（无来源 state）时返回仍以该节点为焦点', async ({ page }) => {
    await page.goto('/map/kp-bool');
    await expect(page.getByRole('heading', { name: '布尔代数基本运算' })).toBeVisible({
      timeout: READY,
    });
    await page.getByRole('button', { name: '返回地图' }).click();
    await expect(page).toHaveURL(/focus=kp-bool/);
  });
});

test.describe('票 03 第 5 条：线性主线视图可切换且位置不丢', () => {
  test('切到主线再切回来，焦点与跳数都不变', async ({ page }) => {
    await page.goto('/map?focus=kp-bool&hops=2');
    await waitForGraph(page);
    const before = Number(await canvas(page).getAttribute('data-node-count'));

    await page.getByRole('button', { name: '线性主线' }).click();
    await expect(page.locator('[data-mainline]')).toBeVisible();
    await expect(page).toHaveURL(/view=mainline/);
    // 主线视图里焦点节点的轮次仍然标着
    await expect(page.locator('[data-mainline] [data-focus="true"]')).toBeVisible();

    await page.getByRole('button', { name: '图谱视图' }).click();
    await waitForGraph(page);

    // 位置没丢：焦点与跳数原样，节点数也回到原样
    await expect(page.getByLabel('选择焦点知识点')).toHaveValue('kp-bool');
    await expect(page).toHaveURL(/hops=2/);
    // 切回图谱会重建画布，`data-node-count` 要等新一次挂载把 props 渲染出来。
    // 单次读会读到重建前/中途的值，于是「位置没丢」被报成「节点数变了」。
    await expect
      .poll(async () => Number((await canvas(page).getAttribute('data-node-count')) ?? 0), {
        timeout: 10_000,
      })
      .toBe(before);
  });

  test('主线视图按模块分组，顺序稳定可复现', async ({ page }) => {
    await page.goto('/map?view=mainline');
    await expect(page.locator('[data-mainline]')).toBeVisible({ timeout: READY });

    const first = await page
      .locator('[data-mainline] [data-module-id]')
      .evaluateAll((sections) => sections.map((s) => s.getAttribute('data-module-id')));

    await page.reload();
    await expect(page.locator('[data-mainline]')).toBeVisible({ timeout: READY });
    const second = await page
      .locator('[data-mainline] [data-module-id]')
      .evaluateAll((sections) => sections.map((s) => s.getAttribute('data-module-id')));

    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(first.length); // 每个模块只出现一次
  });

  test('主线视图也能点进关卡', async ({ page }) => {
    await page.goto('/map?view=mainline');
    await expect(page.locator('[data-mainline]')).toBeVisible({ timeout: READY });
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
    /**
     * 这条用例光等页面就花掉一大半预算：`/map` 要拉回 1789 个叶节点
     * （466 KB）再交给 sigma 建 WebGL 画布，本机无 GPU 走 SwiftShader，
     * 实测 `goto` → 画布可见就要 6–11 秒；之后还有三次 `expect.poll`
     * （各上限 10 秒）+ 12 次 `mouse.wheel`。预算是文件级的 120 秒
     * （见顶部 `test.describe.configure`），这里不再单独 `test.slow()`：
     * 全文件每一条 `/map` 用例都要等同样的冷加载，那是共有成本，
     * 不是这一条特别慢。
     */
    await page.goto('/map');
    await waitForGraph(page);

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
    // 必须 poll，不能读一次：`data-labels-visible` 跟着相机 ratio 立刻翻，
    // 而 `data-labels-displayed` 要等 sigma 在下一帧重算显示集合（且上报
    // 侧有 100ms 节流）。一次读到的常常还是缩小前的 18，断言会红在
    // 「标签其实已经没了」的时刻 —— 那是测试读得太早，不是产品没隐藏。
    await expect
      .poll(async () => Number(await canvas(page).getAttribute('data-labels-displayed')), {
        timeout: 10_000,
      })
      .toBeLessThanOrEqual(1);

    // 放大回来，标签应当恢复
    for (let i = 0; i < 7; i += 1) await page.mouse.wheel(0, -260);
    await expect
      .poll(async () => await canvas(page).getAttribute('data-labels-visible'), { timeout: 10_000 })
      .toBe('true');
  });

  test('键盘也能缩放（滚轮对键盘用户不可用）', async ({ page }) => {
    /**
     * 与上一条同样的成本结构：`/map` 冷加载就要 6–11 秒（1789 个叶节点、
     * 466 KB 响应、SwiftShader 软渲染），再加上连点三次缩放按钮（每次让
     * sigma 重算相机并刷新渲染，实测 0.3–0.6 秒）。预算走文件级 120 秒。
     */
    await page.goto('/map');
    await waitForGraph(page);

    const ratio = async () => Number(await canvas(page).getAttribute('data-camera-ratio'));
    const before = await ratio();

    await page.getByRole('button', { name: '缩小图谱' }).click();
    // 必须等 ratio 真的落地再点下一个：点击只是把相机切到动画，立刻连点
    // 第二、第三个会让三个动画叠在一起，`toBe(1)` 读到中间值。
    await expect.poll(ratio, { timeout: 10_000 }).toBeGreaterThan(before);

    await page.getByRole('button', { name: '放大图谱' }).click();
    await expect.poll(ratio, { timeout: 10_000 }).toBe(before);

    await page.getByRole('button', { name: '复位图谱视野' }).click();
    await expect.poll(ratio, { timeout: 10_000 }).toBe(1);
  });
});

test.describe('票 03 第 7 条：全键盘可达', () => {
  test('Tab 能逐个走到节点清单里的按钮', async ({ page }) => {
    await page.goto('/map');
    await expect(rosterItems(page).first()).toBeVisible({ timeout: READY });

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
    await expect(rosterItems(page).first()).toBeVisible({ timeout: READY });
    await rosterItems(page).first().focus();
    // :focus-visible 的描边由 graph.css 给；这里断言它确实生效了
    const outline = await rosterItems(page)
      .first()
      .evaluate((el) => getComputedStyle(el).outlineWidth);
    expect(outline).not.toBe('0px');
  });

  test('Enter 从清单项进入关卡', async ({ page }) => {
    await page.goto('/map');
    await expect(rosterItems(page).first()).toBeVisible({ timeout: READY });

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
    await waitForGraph(page);

    // WebGL 层是 aria-hidden：里面没有可读内容，不该被读屏扫到
    await expect(page.locator('.graph-canvas-webgl')).toHaveAttribute('aria-hidden', 'true');

    // 视野描述是 aria-live 的，读屏用户能听到「现在看的是哪一块、多少个点」
    const description = page.locator('[data-view-description]');
    await expect(description).toHaveAttribute('aria-live', 'polite');
    await expect(description).toContainText('个微知识点');
  });

  test('缩放入口可用键盘操作', async ({ page }) => {
    await page.goto('/map');
    await waitForGraph(page);
    const zoomIn = page.getByRole('button', { name: '放大图谱' });
    await zoomIn.focus();
    await expect(zoomIn).toBeFocused();
    await page.keyboard.press('Enter');
  });
});

test.describe('图谱与看板的导航一致性', () => {
  test('从地图点进详情，再返回地图时落到该节点为焦点的视图', async ({ page }) => {
    // 票 13 落地后 `/board` 是「今日推荐 + 摘要 + 常用指令」，不再是知识点卡片
    // 网格（那个职责在票 01 时属于 `/board`，后来搬到 `/map`）。所以这条用例
    // 从地图起步 —— 它要验的本来就是「从地图进详情、从详情回地图」这条往返
    // 路径，`/board` 只是当时恰好有个能点的节点列表。
    await page.goto('/map');
    await expect(rosterItems(page).first()).toBeVisible({ timeout: READY });
    // 五态词表全列，别只写三个：正则漏掉某个状态时的症状是「那种状态的节点
    // 一个都匹配不到」，看起来像界面空了，实际只是正则少写了一个词。
    //
    // 必须把查找范围收进清单（`aria-label="当前视野内的微知识点"`）里。不收
    // 范围的话 `.first()` 命中的是**图例的筛选按钮**（可访问名形如「已掌握
    // 0/0」）—— 它名字里也有状态词、也确实可见，点它是「按状态过滤」而不是
    // 「打开这个知识点」，于是用例永远停在 `/map`，报出来的却是「URL 不对」。
    const roster = page.getByRole('list', { name: '当前视野内的微知识点' });
    const item = roster.getByRole('button', { name: /未学习|刚接触|已熟悉|已熟练|已掌握/ }).first();
    await expect(item).toBeVisible({ timeout: READY });
    const label = await item.getAttribute('aria-label');
    const name = (label ?? '').split('，')[0];

    await item.click();
    await expect(page).toHaveURL(/\/map\/.+/);
    await expect(page.getByRole('heading', { name })).toBeVisible();

    await page.getByRole('button', { name: '返回地图' }).click();
    await expect(page).toHaveURL(/focus=/);
    await waitForGraph(page);
  });

  test('顶栏切到知识地图后画布就绪', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: '知识地图' }).click();
    await expect(page).toHaveURL(/\/map/);
    await waitForGraph(page);
  });
});

test.describe('无障碍名沿用既有格式（不弄坏 smoke.spec.ts）', () => {
  test('清单项的可访问名是「名称，状态，百分比/证据不足」', async ({ page }) => {
    await page.goto('/map');
    await expect(rosterItems(page).first()).toBeVisible({ timeout: READY });

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

  test('清单上看得见的状态文字只能来自五态词表', async ({ page }) => {
    await page.goto('/map');
    await expect(rosterItems(page).first()).toBeVisible({ timeout: READY });

    // 这条原来是 `getByText('已熟悉').toBeVisible()`，注释写着「真实数据里 kp-bool
    // 就是 familiar」。它断言的其实不是界面行为，而是「库里恰好有一个 familiar
    // 节点」—— 那个 familiar 来自 seed.sql 手写的一行掌握度快照，而它声称的 10
    // 次作答在 `app.attempts` 里一条都没有（伪造的证据，已随迁移 0005 与 seed
    // 一并删除）。删掉假数据后这条就红了，说明它钉的是数据。
    //
    // 换成只看渲染规则的断言：清单每一条都渲染了状态文字，且两层词都在各自的
    // 词表里。词表漏翻（露出 `familiar` 这类英文原值）或多出一个契约里不存在的
    // 词时才会红。
    //
    // 注意是**两层**词：括号外是四类显示桶（未学/在学/已掌握/需复验，票 03 的
    // 画布分类），括号里是五档引擎状态（`FINE_LABEL`）。写成一层会混淆这两件事。
    const BUCKET_LABEL = ['未学', '在学', '已掌握', '需复验'];
    const FINE_LABEL = ['未学习', '刚接触', '已熟悉', '已熟练', '已掌握'];
    const states = await rosterItems(page).evaluateAll((items) =>
      items.slice(0, 30).map((item) => item.querySelector('.graph-roster-state')?.textContent ?? ''),
    );
    expect(states.length).toBeGreaterThan(0);
    for (const text of states) {
      const [outer = '', inner = ''] = text.split('（');
      expect(BUCKET_LABEL).toContain(outer);
      expect(FINE_LABEL).toContain(inner.replace('）', ''));
    }
  });
});
