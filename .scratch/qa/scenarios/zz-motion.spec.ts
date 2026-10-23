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
import { chromium, expect, test } from '@playwright/test';

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

test.describe('动效底座：夹具不进真实应用', () => {
  test('应用页面没有挂载夹具的全局函数', async ({ page }) => {
    // `qaHarness.tsx` 在模块顶层写了 `window.__mountMotionHarness`。只要它被
    // 任何应用入口 import 到，这个函数就会出现在真实页面上——它比「产物里多
    // 一段代码」更能说明问题，因为它是**运行时可见的**副作用。
    //
    // 单元测试 `qaHarness.test.ts` 扫的是源码字符串（静态、快），这条扫的是
    // 运行结果（动态、真）。两条都要：静态那条能指出是哪个文件干的，动态这条
    // 能兜住静态扫描看不见的路径（例如某人绕一层再 import）。
    await page.goto('/');
    const leaked = await page.evaluate(() => ({
      mount: typeof (window as unknown as Record<string, unknown>).__mountMotionHarness,
      ready: typeof (window as unknown as Record<string, unknown>).__motionHarnessReady,
    }));
    expect(leaked.mount).toBe('undefined');
    expect(leaked.ready).toBe('undefined');
  });
});

// ===========================================================================
// t60：连续缩放镜头（地图全局 → 知识点近景）
// ===========================================================================
//
// ## 为什么这一组必须用**真 GPU**
//
// 本机是 Intel Arc 核显。默认的 `chromium.launch()`（Playwright 的 headless）
// 走的是 **SwiftShader 软件光栅**：同一页面的 rAF 只有 4–5fps（实测空白页
// 60fps、`/map` 4.2fps）。在那里量出来的数字描述的是「CPU 软件光栅化 3085 个
// 节点」的成本，不是产品在用户机器上的表现——把它当成产品帧率会得出完全错误
// 的结论（「地图太慢，必须降节点数」），而真正的结论是「这台机器的 headless
// 没有用 GPU」。
//
// 所以这一组用 `--use-angle=d3d11` 把 ANGLE 指向真显卡，并在测试里**读
// `WEBGL_debug_renderer_info` 验证**拿到的是 Intel 而不是 SwiftShader；
// 拿到 SwiftShader 时帧率断言会**跳过**而不是假装通过（跳过是诚实的：那不是
// 本机 GPU 的表现）。
//
// ## 为什么节点坐标要从 React fiber 里摸
//
// 节点坐标是**客户端力导向布局**的产物（`graph/layout.ts`：确定性向日葵种子
// + FA2 收敛），不来自接口，也没有暴露任何调试句柄。而布局的收敛结果依赖
// 墙钟时间（迭代次数随帧预算浮动），所以在测试里重算一遍**不可能**得到与
// 页面一致的坐标。
//
// 于是这里借用 React 在 DOM 节点上挂的 `__reactFiber$*` 键，走到
// `GraphCanvas` 的 hook 链里找到 sigma 实例的 ref，读它 `graph` 的真实属性。
// 这是**测试侧的权宜**，不进入产品代码；它验证的恰恰是验收要的东西——
// 「起点取地图上该节点的真实坐标（sigma 的归一化坐标）」。产品若将来提供
// 正式调试句柄，这段可以整段删掉。
import type { Page } from '@playwright/test';
import { shot } from './_helpers';

/** 让 ANGLE 走真显卡。缺了它，headless 会用 SwiftShader 软光栅。 */
const GPU_ARGS = ['--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];

interface NodePick {
  id: string;
  x: number;
  y: number;
  degree: number;
}

interface SigmaSnapshot {
  nodeCount: number;
  picks: NodePick[];
  /** 全部节点的图坐标（避让计算用）。 */
  all: [number, number][];
  /** 包围盒对角线＝「一个视口宽」的世界尺度（图坐标，非像素）。 */
  extent: number;
  /** WebGL renderer 字符串，用来识别 SwiftShader。 */
  renderer: string;
}

/** 帧率采样器（与 `zz-fps-map.spec.ts` 同构，但不依赖它的夹具）。 */
function samplerInit(): void {
  const w = window as unknown as {
    __fps?: {
      frames: number[];
      long: number[];
      running: boolean;
      obs?: PerformanceObserver;
      start(): void;
      stop(): {
        frames: number;
        p50: number;
        p95: number;
        max: number;
        fpsP50: number;
        longMax: number;
        longTasks: number;
      };
    };
  };
  w.__fps = {
    frames: [],
    long: [],
    running: false,
    start() {
      this.frames = [];
      this.long = [];
      this.running = true;
      let last = 0;
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) this.long.push(Math.round(entry.duration));
      });
      try {
        obs.observe({ entryTypes: ['longtask'] });
      } catch {
        /* 不支持 longtask 就只量帧间隔 */
      }
      this.obs = obs;
      const tick = (ts: number): void => {
        if (!this.running) return;
        if (last > 0) this.frames.push(ts - last);
        last = ts;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    stop() {
      this.running = false;
      this.obs?.disconnect();
      const frames = [...this.frames].sort((a, b) => a - b);
      const at = (p: number): number =>
        frames.length ? Math.round(frames[Math.min(frames.length - 1, Math.floor(frames.length * p))] * 10) / 10 : -1;
      return {
        frames: frames.length,
        p50: at(0.5),
        p95: at(0.95),
        max: frames.length ? Math.round(frames[frames.length - 1]) : -1,
        fpsP50: at(0.5) > 0 ? Math.round(1000 / at(0.5)) : 0,
        longMax: this.long.length ? Math.max(...this.long) : 0,
        longTasks: this.long.length,
      };
    },
  };
}

/**
 * 等知识地图真的画出来（`data-node-count` 先出现，布局还要再收敛一会儿）。
 *
 * 5 秒是 `GraphCanvas` 的 `LAYOUT_BUDGET_MS`。不等它，量到的帧率里会混进
 * 「布局在算」的开销，而那是页面加载成本，不是镜头成本。
 */
async function waitForMap(page: Page): Promise<number> {
  await page.goto('/map');
  await page.waitForSelector('.graph-canvas[data-node-count]', { timeout: 60_000 });
  await page.waitForFunction(
    () => Number(document.querySelector('.graph-canvas')?.getAttribute('data-node-count') ?? 0) > 3000,
    null,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(5_000);
  return page.evaluate(() => Number(document.querySelector('.graph-canvas')?.getAttribute('data-node-count') ?? 0));
}

/**
 * 从 fiber 里找到 sigma 的图，读出真实节点坐标 + 三个「铺得开」的目标节点。
 *
 * 三个目标点按 120° 均布在半径 0.3 的圆上，各取最近的节点：这样三条镜头路径
 * 方向不同，才能说明「不是只对某个方向成立」。半径 0.3 保证 ratio=1 时落在
 * 视口内（归一化坐标 0–1，中心 0.5）。
 */
async function readSigma(page: Page): Promise<SigmaSnapshot | null> {
  return page.evaluate(() => {
    const renderer = (() => {
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        if (!gl) return 'no-webgl';
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'no-debug-info';
      } catch (error) {
        return `err:${String(error)}`;
      }
    })();

    const el = document.querySelector('.graph-canvas');
    if (!el) return null;
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    if (!key) return null;
    let fiber = (el as unknown as Record<string, { return: unknown }>)[key] as unknown as {
      return: unknown;
      child: unknown;
      sibling: unknown;
      memoizedState: unknown;
    };
    while (fiber.return) fiber = fiber.return as typeof fiber;
    const stack: typeof fiber[] = [fiber];
    let visited = 0;
    type GraphLike = {
      order: number;
      nodes(): string[];
      degree(id: string): number;
      getNodeAttributes(id: string): { x: number; y: number };
    };
    while (stack.length > 0 && visited < 300_000) {
      const node = stack.pop() as typeof fiber;
      visited += 1;
      let hook = node.memoizedState as null | {
        current?: unknown;
        memoizedState?: unknown;
        next?: unknown;
      };
      let depth = 0;
      while (hook && typeof hook === 'object' && depth < 60) {
        depth += 1;
        const inner = hook.memoizedState as { current?: unknown } | null | undefined;
        const candidates: unknown[] = [hook.current, inner?.current, inner];
        for (const candidate of candidates) {
          const graph = (candidate as { graph?: GraphLike } | null)?.graph;
          if (graph && typeof graph.getNodeAttributes === 'function' && typeof graph.nodes === 'function') {
            const ids = graph.nodes();
            const all: [number, number][] = ids.map((id) => {
              const attrs = graph.getNodeAttributes(id);
              return [attrs.x, attrs.y];
            });
            // 图坐标**不是** 0–1：它是布局吐出来的原始坐标（本仓 3085 个节点
            // 铺开几十个单位）。所以目标点要在**真实包围盒**里取比例位置，
            // 否则三个「不同方向」会全都落到同一个最近节点上（实测过）。
            let minX = Number.POSITIVE_INFINITY;
            let maxX = Number.NEGATIVE_INFINITY;
            let minY = Number.POSITIVE_INFINITY;
            let maxY = Number.NEGATIVE_INFINITY;
            for (const [x, y] of all) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
            const extent = Math.hypot(maxX - minX, maxY - minY);
            const at = (nx: number, ny: number): [number, number] => [
              minX + nx * (maxX - minX),
              minY + ny * (maxY - minY),
            ];
            // 120° 均布、半径 0.3：三条路径方向不同，才说明「不是只对某个方向成立」。
            const ideals = [at(0.8, 0.5), at(0.35, 0.76), at(0.35, 0.24)];
            const picks = ideals.map(([ix, iy]) => {
              let best = '';
              let bestDistance = Number.POSITIVE_INFINITY;
              for (const id of ids) {
                const attrs = graph.getNodeAttributes(id);
                const d = Math.hypot(attrs.x - ix, attrs.y - iy);
                if (d < bestDistance) {
                  bestDistance = d;
                  best = id;
                }
              }
              const attrs = graph.getNodeAttributes(best);
              return { id: best, x: attrs.x, y: attrs.y, degree: graph.degree(best) };
            });
            return { nodeCount: graph.order, picks, all, extent, renderer };
          }
        }
        hook = hook.next as typeof hook;
      }
      if (node.child) stack.push(node.child as typeof fiber);
      if (node.sibling) stack.push(node.sibling as typeof fiber);
    }
    return null;
  });
}

interface ZoomKick {
  id: string;
  from: { x: number; y: number; ratio: number };
  to: { x: number; y: number; ratio: number };
  ms: number;
  detour: number;
  density: number;
  straightDensity: number;
}

/** 起手一段镜头（不 await），并把规划结果交回 Node 侧。 */
async function kickZoom(page: Page, pick: NodePick, all: [number, number][]): Promise<ZoomKick> {
  return page.evaluate(
    async ({ target, nodes }) => {
      const motion = await import('/src/motion/useCinematicZoom.ts');
      const flight = await import('/src/motion/camera-flight.ts');
      const camera = flight.activeFlightCamera();
      if (!camera) throw new Error('没有活跃相机');
      const from = camera.getState();
      const plan = motion.planCinematicZoom({ from, to: target, nodes });
      const straight = motion.planCinematicZoom({ from, to: target });
      const w = window as unknown as { __zoomDone?: boolean; __fps?: { start(): void; stop(): unknown } };
      w.__zoomDone = false;
      w.__fps?.start();
      // 不 await：Node 侧要在飞行途中截三帧。
      void motion.runCinematicZoom(camera, plan).then((ran: boolean) => {
        const after = camera.getState();
        w.__zoomDone = true;
        (window as unknown as { __zoomResult?: unknown }).__zoomResult = {
          ran,
          after,
          sample: w.__fps?.stop(),
        };
      });
      return {
        id: plan.id,
        from: plan.from,
        to: plan.to,
        ms: plan.ms,
        detour: plan.detour,
        density: motion.densityAlong(plan, nodes),
        straightDensity: motion.densityAlong(straight, nodes),
      };
    },
    { target: pick, nodes: all },
  );
}

/**
 * 自己起一个**带 GPU 参数**的 Chromium。
 *
 * `test.use({ launchOptions })` 不能写在 describe 里（Playwright 会拒绝：它要求
 * 换 worker），而改共享的 `playwright.config.ts` 会波及别人的泳道。所以这里
 * 直接 `chromium.launch()`，把参数限定在这一组用例内。
 */
async function withGpuPage(run: (page: Page) => Promise<void>): Promise<void> {
  const baseURL = test.info().project.use.baseURL ?? 'http://localhost:5173';
  const browser = await chromium.launch({ args: GPU_ARGS });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL });
  const page = await context.newPage();
  try {
    await run(page);
  } finally {
    await browser.close();
  }
}

test.describe('t60 连续缩放镜头', () => {
  test('地图全局 → 三个知识点：连续缩放、三帧存证、帧率达标', async () => {
    await withGpuPage(async (page) => {
      const nodeCount = await waitForMap(page);
      expect(nodeCount).toBeGreaterThan(3000);

      await page.evaluate(samplerInit);
      const snapshot = await readSigma(page);
      expect(snapshot, 'fiber 里没找到 sigma 的图').not.toBeNull();
      const { picks, all, extent, renderer } = snapshot!;
      // 三个目标必须真的不同：同一节点重复三次等于只验了一个方向。
      expect(new Set(picks.map((pick) => pick.id)).size).toBe(3);
      // 世界尺度必须是「几十个单位」量级，否则说明拿到的不是真实布局。
      expect(extent).toBeGreaterThan(1);

      // 软光栅下不量帧率：那不是本机 GPU 的表现，硬断言会撒谎。
      const softwareRaster = /swiftshader|llvmpipe|software/i.test(renderer);

      for (let index = 0; index < picks.length; index += 1) {
        const pick = picks[index]!;
        // 开场先回全局视野：镜头必须从「整张图」出发，而不是上一段镜头的落点。
        await page.getByRole('button', { name: '复位图谱视野' }).click();
        await page.waitForTimeout(500);

        const kick = await kickZoom(page, pick, all);
        // 起点：真实全局视野（复位后 x/y=0.5、ratio=1）。
        expect(kick.from.ratio).toBeCloseTo(1, 3);
        expect(kick.ms).toBeGreaterThanOrEqual(420);
        expect(kick.ms).toBeLessThanOrEqual(700);

        await page.waitForTimeout(30);
        await shot(page, `motion-map→node-${index}-start`);
        await page.waitForTimeout(Math.max(60, Math.round(kick.ms * 0.4)));
        await shot(page, `motion-map→node-${index}-mid`);
        await shot(page, `motion-map→node-${index}`);
        await page.waitForFunction(() => (window as unknown as { __zoomDone?: boolean }).__zoomDone === true, null, {
          timeout: 10_000,
        });
        await shot(page, `motion-map→node-${index}-end`);

        const result = await page.evaluate(
          () =>
            (window as unknown as { __zoomResult?: unknown }).__zoomResult as {
              ran: boolean;
              after: { x: number; y: number; ratio: number };
              sample: Record<string, number>;
            },
        );

        // 地理一致性：终点就是那个节点本身（sigma 归一化坐标），ratio 收窄到近景。
        expect(result.after.x).toBeCloseTo(kick.to.x, 6);
        expect(result.after.y).toBeCloseTo(kick.to.y, 6);
        expect(result.after.ratio).toBeLessThan(0.5);
        // 路径不穿过密集区：沿途走廊内的节点数不超过「密集」阈值（6），
        // 且绕行之后不高于直线（没有为了绕而绕进更密的地方）。
        expect(kick.density).toBeLessThanOrEqual(6);
        expect(kick.density).toBeLessThanOrEqual(kick.straightDensity);
        expect(Number.isNaN(kick.detour)).toBe(false);

        if (!softwareRaster) {
          // eslint-disable-next-line no-console
          console.log(
            `[t60-zoom] node-${index} ${pick.id} from=(${kick.from.x.toFixed(3)},${kick.from.y.toFixed(3)}) to=(${kick.to.x.toFixed(3)},${kick.to.y.toFixed(3)}) ms=${kick.ms} detour=${kick.detour.toFixed(3)} density=${kick.density}/${kick.straightDensity} renderer=${renderer}`,
            JSON.stringify(result.sample),
          );
          expect(result.sample.frames).toBeGreaterThan(10);
          // P50 ≥ 50fps ⇒ 帧间隔中位数 ≤ 20ms。
          expect(result.sample.p50).toBeLessThanOrEqual(20);
          expect(result.sample.longMax).toBeLessThan(100);
        } else {
          // eslint-disable-next-line no-console
          console.log(`[t60-zoom] 跳过帧率断言：renderer=${renderer}`);
        }
      }
    });
  });

  test('reduce 下镜头一次到位、零动画，页面仍可用', async () => {
    await withGpuPage(async (page) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await waitForMap(page);

      const snapshot = await readSigma(page);
      expect(snapshot).not.toBeNull();
      const pick = snapshot!.picks[0]!;

      const outcome = await page.evaluate(
        async (target) => {
          const motion = await import('/src/motion/useCinematicZoom.ts');
          const flight = await import('/src/motion/camera-flight.ts');
          const camera = flight.activeFlightCamera();
          if (!camera) throw new Error('没有活跃相机');
          // 记录每次 setState：reduce 的承诺是「一次到位、没有中间帧」。
          const calls: { x: number; y: number; ratio: number }[] = [];
          const original = camera.setState.bind(camera);
          camera.setState = (next: { x?: number; y?: number; ratio?: number }) => {
            calls.push({ ...camera.getState(), ...next });
            original(next);
          };
          const before = camera.getState();
          const t0 = performance.now();
          await motion.zoomToNode(target);
          const ms = Math.round(performance.now() - t0);
          return { before, after: camera.getState(), calls: calls.length, ms, animations: document.getAnimations().length };
        },
        { id: pick.id, x: pick.x, y: pick.y },
      );

      // 一次 setState，零中间帧。
      expect(outcome.calls).toBe(1);
      expect(outcome.ms).toBeLessThan(100);
      expect(outcome.animations).toBe(0);
      expect(outcome.after.x).toBeCloseTo(pick.x, 6);
      expect(outcome.after.y).toBeCloseTo(pick.y, 6);
      expect(outcome.after.ratio).toBeCloseTo(outcome.before.ratio * 0.35, 6);

      // 页面仍可用：画布还能交互（缩放按钮真的改 ratio）。
      const before = await page.locator('.graph-canvas').getAttribute('data-camera-ratio');
      await page.getByRole('button', { name: '缩小图谱' }).click();
      await page.waitForTimeout(300);
      const after = await page.locator('.graph-canvas').getAttribute('data-camera-ratio');
      expect(after).not.toBe(before);
    });
  });

  test('View Transitions 存在时真跑一次；删掉它则退化为 200ms 推近', async () => {
    await withGpuPage(async (page) => {
      await waitForMap(page);

      const supported = await page.evaluate(
        () => typeof (document as unknown as { startViewTransition?: unknown }).startViewTransition === 'function',
      );

      if (supported) {
        const seen = await page.evaluate(async () => {
          const motion = await import('/src/motion/transitions.tsx');
          let insideAttr: string | null = 'not-observed';
          const outcome = await motion.runStageTransition(
            () => {
              insideAttr = document.documentElement.getAttribute('data-sm-transition');
            },
            { kind: 'zoom-in' },
          );
          return {
            outcome,
            insideAttr,
            afterAttr: document.documentElement.getAttribute('data-sm-transition'),
            animations: document.getAnimations().length,
          };
        });
        expect(seen.outcome).toBe('view-transition');
        // 属性必须**在提交新 DOM 之前**挂上：CSS 靠它选 zoom-in 的 keyframes。
        expect(seen.insideAttr).toBe('zoom-in');
        expect(seen.afterAttr).toBeNull();
        expect(seen.animations).toBeGreaterThan(0);
      }

      // 降级路径：把 API 摘掉，转场必须仍然完成导航，并补一段 200ms 推近。
      const fallback = await page.evaluate(async () => {
        // `document.startViewTransition` 挂在 **Document.prototype** 上：
        // 删实例属性是无效操作（实测 outcome 仍是 view-transition）。
        const proto = Document.prototype as unknown as { startViewTransition?: unknown };
        const had = typeof document.startViewTransition === 'function';
        delete proto.startViewTransition;
        const motion = await import('/src/motion/transitions.tsx');
        // 兜底动画在 `runStageTransition` 返回前就 `cancel()` 了（这正是它不
        // 留垃圾动画的证据），所以事后查 `getAnimations()` 看不到它。
        // 要验「真有一段 200ms 的推近」，只能观察它被发起的那一刻。
        const original = (Element.prototype as unknown as { animate: unknown }).animate;
        const calls: { duration: number; keys: string[]; fill: string }[] = [];
        (Element.prototype as unknown as { animate: unknown }).animate = function (
          this: Element,
          keyframes: Keyframe[],
          options: number | KeyframeAnimationOptions,
        ) {
          const timing = typeof options === 'number' ? { duration: options } : (options ?? {});
          calls.push({
            duration: Number((timing as KeyframeAnimationOptions).duration ?? 0),
            keys: Object.keys(keyframes[0] ?? {}),
            fill: String((timing as KeyframeAnimationOptions).fill ?? ''),
          });
          return (original as (this: Element, k: Keyframe[], o: number | KeyframeAnimationOptions) => Animation).call(
            this,
            keyframes,
            options,
          );
        };
        let updated = false;
        const started = performance.now();
        let outcome: string = 'threw';
        try {
          outcome = await motion.runStageTransition(() => {
            updated = true;
          });
        } finally {
          (Element.prototype as unknown as { animate: unknown }).animate = original;
        }
        const ms = Math.round(performance.now() - started);
        return { had, outcome, updated, ms, calls };
      });

      expect(fallback.outcome).toBe('fallback');
      expect(fallback.updated).toBe(true);
      // eslint-disable-next-line no-console
      console.log('[t60-fallback]', JSON.stringify(fallback.calls), 'ms=', fallback.ms);
      // 200ms 的推近：不是「什么都不动」，也不是「等 350ms 的场景转场」。
      const push = fallback.calls.find((call) => call.duration === 200);
      expect(push, `兜底动画参数：${JSON.stringify(fallback.calls)}`).toBeDefined();
      // 只动合成层：opacity + transform，不碰布局属性。
      expect(push!.keys.sort()).toEqual(['opacity', 'transform']);
      // 请求的时长是 200ms（上面那条已在 `animate()` 调用里验到）。这里的
      // 墙钟只做「确实等过一次动画」的下界断言，不设紧上界：动画的 finished
      // 由合成器调度决定，同一段代码实测 228ms（空闲）／602ms（整机 847 个
      // 单测 + 地图页面抢 CPU 时）。把上界卡在 400 会变成测机器忙不忙。
      expect(fallback.ms).toBeGreaterThanOrEqual(200);
      expect(fallback.ms).toBeLessThan(1500);
    });
  });
});
