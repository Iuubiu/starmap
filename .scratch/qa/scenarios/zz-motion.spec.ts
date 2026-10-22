/**
 * 动效底座的**浏览器验收**（t65 验收第 6 条）。
 *
 * 单测（`apps/web/src/motion/motion.test.tsx`）只能证明「我们调用了
 * `element.animate()` / `requestAnimationFrame()`」。它证明不了动画真的被浏览器
 * 接受并合成，也证明不了 `document.getAnimations()` 里真的空了——而 reduce 降级
 * 的整个承诺就落在那一层。这个文件补的正是那一段。
 *
 * ## 为什么断言的是「双向」
 *
 * 只断言「reduce 下没有动画」是一条**永远不会失败**的测试：一个从来没实现过
 * 动效的页面同样满足它。必须同时断言「非 reduce 下确实有动画」，两条合起来才
 * 排除了「什么都没做」这种解释。验收原文写的就是这个意思。
 *
 * ## 为什么在夹具页（`/src/motion/qaHarness.html`）上测，而不是在真实页面上
 *
 * `document.getAnimations()` 是**全文档**口径。真实页面里有 Fluent UI 的
 * TabList 指示条、侧栏抽屉、MessageBar 进出场——它们各自可能有 CSS 过渡，
 * 采样那一刻只要有一个还在跑，失败原因就和「我们的动效没关掉」混在一起。
 * 夹具页只挂被测组件，`0` 就是真的 `0`。
 *
 * 真实页面的可用性另有一条（第三条）：reduce 下打开首页与知识地图，页面内容
 * 齐全、可交互。它不数动画，只保证「关掉动效 ≠ 关掉功能」。
 */
import { expect, test } from '@playwright/test';

const HARNESS = '/src/motion/qaHarness.html';

/** 夹具挂载当帧写出的快照（定义见 `apps/web/src/motion/qaHarness.tsx`）。 */
interface ProbeReport {
  reduced: boolean;
  subtreeDurations: number[];
  documentAnimations: number;
  documentDurations: number[];
  countUpFirstRender: string;
}

/**
 * 打开夹具页、按给定媒体偏好挂载组件，返回**挂载当帧**的快照。
 *
 * 快照是在 React commit 的 effect 里同步抓的，不是探针轮询读的：动画只有
 * 120ms，一次 `evaluate` 往返就可能错过窗口，那样「非 reduce 下确实播了」会
 * 变成一条随机失败的断言。
 */
async function mountHarness(
  page: import('@playwright/test').Page,
  reducedMotion: 'reduce' | 'no-preference',
): Promise<ProbeReport> {
  await page.emulateMedia({ reducedMotion });
  await page.goto(HARNESS);
  // 内联模块脚本跑完才导出挂载函数，先等它就位。
  await page.waitForFunction(() => window.__motionHarnessReady === true, undefined, {
    timeout: 30_000,
  });

  await page.evaluate(() => {
    const mount = window.__mountMotionHarness;
    if (mount === undefined) throw new Error('夹具页没有导出 mountMotionHarness');
    const host = document.getElementById('host');
    if (host === null) throw new Error('夹具页缺少 #host');
    mount(host);
  });

  // `createRoot().render()` 不保证同步 commit，所以要等夹具自己写出快照。
  // 等的是「快照出现」，不是「某一帧」——快照内容固定是挂载当帧的。
  await page.waitForFunction(() => window.__motionProbe !== undefined, undefined, {
    timeout: 10_000,
  });
  return page.evaluate(() => window.__motionProbe as ProbeReport);
}

test.describe('动效底座：reduce 降级', () => {
  test('非 reduce：入场动画真的进了浏览器', async ({ page }) => {
    const report = await mountHarness(page, 'no-preference');

    expect(report.reduced).toBe(false);
    // 全文档至少一个动画在跑。`0` 说明 `element.animate()` 没被调用，
    // 或者被浏览器拒绝了——两种情况都意味着下面那条 reduce 断言毫无意义。
    expect(report.documentAnimations).toBeGreaterThan(0);
    // 入场动画的时长必须是 `quick`（120ms），不是浏览器默认值。
    expect(report.subtreeDurations).toContain(120);
    // 数字滚动的首帧是 0：滚动确实发生了，不是直接跳到终值。
    expect(report.countUpFirstRender).toBe('0');
  });

  test('reduce：整个文档零动画，且首帧即终值', async ({ page }) => {
    const report = await mountHarness(page, 'reduce');

    expect(report.reduced).toBe(true);
    // 验收原文的口径：`document.getAnimations().length === 0`。
    expect(report.documentAnimations).toBe(0);
    expect(report.documentDurations).toEqual([]);
    expect(report.subtreeDurations).toEqual([]);
    // 数字不是「先渲染 0 再跳」：首帧就是终值，没有任何一帧的闪烁。
    expect(report.countUpFirstRender).toBe('1234');
  });
});

test.describe('动效底座：真实页面在 reduce 下仍完整可用', () => {
  test('首页与知识地图在 reduce 下内容齐全', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.goto('/');
    // 侧栏导航是每个页面都有的骨架，出现即说明壳子渲染完了。
    await expect(page.getByRole('tab', { name: '知识地图' })).toBeVisible();
    // 正文不是空白：取主区域文本长度，太短说明是空壳或错误页。
    const homeText = await page.locator('main').innerText();
    expect(homeText.trim().length).toBeGreaterThan(40);

    await page.goto('/map');
    // 地图是 WebGL 画布，等 sigma 把节点数写进 data 属性即视为就绪。
    await page.waitForSelector('.graph-canvas[data-node-count]', { timeout: 60_000 });
    const nodeCount = await page
      .locator('.graph-canvas')
      .first()
      .getAttribute('data-node-count');
    expect(Number(nodeCount)).toBeGreaterThan(0);
    // 画布有真实尺寸（不是 0×0 的塌陷），否则「可用」是假的。
    const box = await page.locator('.graph-canvas').first().boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(200);
    expect(box?.height ?? 0).toBeGreaterThan(200);
  });
});
