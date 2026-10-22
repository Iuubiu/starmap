/**
 * 动效泳道的帧率采样器（**测量脚本，不是门禁用例**）。
 *
 * 只在 `MOTION_FPS=1` 时运行，否则整份 skip。文件名刻意**不**叫
 * `zz-motion*`：门禁命令
 * `npx playwright test --config=../../.scratch/qa/playwright.config.ts zz-motion`
 * 是按文件名子串匹配的，测量脚本混在里面会把门禁从 3 条用例变成十几条，
 * 还会带上 30 秒级的建图等待。门禁只认 `zz-motion.spec.ts`。
 *
 * ## 采样口径
 *
 * 用 `requestAnimationFrame` 记每一帧的时间戳，然后算**帧间隔**（相邻两帧的
 * 时间差），而不是「帧数 ÷ 时长」。原因：转场是有限时长的一段，开头结尾的
 * 半帧会把平均值带偏；而 P50 帧间隔直接对应「大多数时候一帧多少毫秒」，
 * 1000/P50 就是稳态帧率。
 *
 * 长任务用 `PerformanceObserver({entryTypes:['longtask']})` 收（>50ms），
 * 与 t53 的 `zz-perf.spec.ts` 同口径，数字可直接对比。
 *
 * ## 为什么要有「灵敏度对照」
 *
 * 一个永远返回 60fps 的采样器和一个真的 60fps 页面在输出上无法区分。所以先
 * 跑一组**已知必然掉帧**的对照：在主线程上放一段同步忙等，采样器必须报出
 * 与忙等时长同量级的最大帧间隔。对照不过，后面的数字一律不可信。
 *
 * 跑法：
 *
 *     cd apps/web
 *     MOTION_FPS=1 npx playwright test --config=../../.scratch/qa/playwright.config.ts \
 *       zz-fps-map --output=../../.scratch/pw-motion-fps-$(date +%s)
 */
import { expect, test, type Page } from '@playwright/test';

const ENABLED = process.env.MOTION_FPS === '1';

/** 采样窗口（ms）。转场本身按 600ms 设计，这里留两倍余量。 */
const WINDOW_MS = Number(process.env.MOTION_WINDOW_MS ?? 1_200);

interface FrameSample {
  /** 采样窗口内总帧数 */
  frames: number;
  /** 帧间隔 P50（ms） */
  p50: number;
  /** 帧间隔 P95（ms） */
  p95: number;
  /** 最长单帧间隔（ms） */
  max: number;
  /** 1000 / p50 */
  fpsP50: number;
  /** 窗口内的 longtask（>50ms） */
  longTasks: Array<{ start: number; dur: number }>;
  /** 最长 longtask（ms），没有则 0 */
  longMax: number;
}

/**
 * 装采样器。必须在页面脚本之前跑（`addInitScript`），这样首帧就能被记到。
 *
 * 返回的是**页面上**的一堆全局函数：`__fps.start()` / `__fps.stop()`。
 * 用全局而不是 test 侧持有，是因为 rAF 回调必须活在页面里。
 */
async function installSampler(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __fps?: {
        start: () => void;
        stop: () => {
          frames: number;
          p50: number;
          p95: number;
          max: number;
          fpsP50: number;
          longTasks: Array<{ start: number; dur: number }>;
          longMax: number;
        };
      };
      __lt?: Array<{ start: number; dur: number }>;
    };
    if (w.__fps) return;

    const stamps: number[] = [];
    const lt: Array<{ start: number; dur: number }> = [];
    w.__lt = lt;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          lt.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) });
        }
      }).observe({ entryTypes: ['longtask'] });
    } catch {
      /* 没有 longtask 就留空数组 */
    }

    let raf = 0;
    let running = false;
    const tick = (t: number): void => {
      stamps.push(t);
      if (running) raf = requestAnimationFrame(tick);
    };

    const quantile = (sorted: number[], q: number): number => {
      if (sorted.length === 0) return 0;
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
      return sorted[idx]!;
    };

    w.__fps = {
      start() {
        stamps.length = 0;
        lt.length = 0;
        running = true;
        raf = requestAnimationFrame(tick);
      },
      stop() {
        running = false;
        cancelAnimationFrame(raf);
        const gaps: number[] = [];
        for (let i = 1; i < stamps.length; i += 1) gaps.push(stamps[i]! - stamps[i - 1]!);
        gaps.sort((a, b) => a - b);
        const p50 = quantile(gaps, 0.5);
        return {
          frames: stamps.length,
          p50,
          p95: quantile(gaps, 0.95),
          max: gaps.length === 0 ? 0 : gaps[gaps.length - 1]!,
          fpsP50: p50 > 0 ? 1000 / p50 : 0,
          longTasks: lt.slice(),
          longMax: lt.reduce((m, e) => Math.max(m, e.dur), 0),
        };
      },
    };
  });
}

async function startSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __fps: { start: () => void } }).__fps.start();
  });
}

async function stopSampling(page: Page): Promise<FrameSample> {
  return page.evaluate(() => {
    return (
      window as unknown as {
        __fps: { stop: () => FrameSample };
      }
    ).__fps.stop();
  });
}

/** 等地图画布真的建起来（`data-node-count` 有值）。 */
async function waitForCanvas(page: Page): Promise<number> {
  await page.waitForSelector('.graph-canvas[data-node-count]', { timeout: 60_000 });
  const count = await page.locator('.graph-canvas').first().getAttribute('data-node-count');
  return Number(count ?? 0);
}

test.describe('t60 帧率采样', () => {
  test.skip(!ENABLED, '测量脚本：需要 MOTION_FPS=1 才跑');

  /**
   * 灵敏度对照：主线程上放一段同步忙等，采样器必须报出同量级的最长帧间隔。
   *
   * 忙等 300ms → 那一段一定会吞掉若干帧，最长帧间隔应当 ≥ 250ms（留一点
   * 计时器精度余量）。这条不过，说明采样器根本没在采样。
   *
   * **忙等必须由页面自己的定时器发起**，不能是 `page.evaluate` 里直接
   * 同步跑：CDP 注入的那次求值不产生 longtask 归因，`PerformanceObserver`
   * 收不到（实测 longMax=0，而同一段 rAF 采样器如实记到了 300ms 空洞）。
   * 这是采样器本身的一个坑，写在这里免得以后误判成「页面没有长任务」。
   */
  test('对照：主线程忙等 300ms 必须被采样器看见', async ({ page }) => {
    await installSampler(page);
    await page.goto('/board');
    await page.waitForLoadState('networkidle');

    await startSampling(page);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          // 从页面定时器队列发起 → 这次忙等会被 longtask 归因
          setTimeout(() => {
            const until = performance.now() + 300;
            while (performance.now() < until) {
              /* 故意堵住主线程 */
            }
            resolve();
          }, 0);
        }),
    );
    await page.waitForTimeout(WINDOW_MS);
    const sample = await stopSampling(page);

    console.log('[motion-fps] 对照（忙等 300ms）', JSON.stringify(sample));
    expect(sample.frames).toBeGreaterThan(5);
    expect(sample.max).toBeGreaterThanOrEqual(250);
    expect(sample.longMax).toBeGreaterThanOrEqual(250);
  });

  /**
   * 基线：路由切换（SPA 内部跳转）现在有多贵。
   *
   * 这是 t60 要给 `useRouteTransition()` 填实现的位置。量两件事：
   *   1. 点击到**新页面首帧**的耗时（`requestAnimationFrame` 双跳）；
   *   2. 这段窗口里的 longtask 总时长。
   *
   * 只量 `/board → /map`：它是最贵的一条（要建 WebGL 画布），也是用户
   * 「从看板点进知识地图」的真实路径。
   */
  test('基线：路由切换 /board → /map 的耗时与长任务', async ({ page }) => {
    await installSampler(page);
    await page.goto('/board');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1_000);

    await startSampling(page);
    const nav = await page.evaluate(async () => {
      const t0 = performance.now();
      // 用历史 API 之外的方式不可靠，这里直接点导航标签
      const link = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find((el) =>
        (el.textContent ?? '').includes('知识地图'),
      );
      if (!link) return { error: '没找到「知识地图」标签', ms: -1 };
      link.click();
      // 等两帧：第一帧提交 React 更新，第二帧画出来
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const painted = performance.now();
      // 再等画布真的出现（sigma 建实例的那一下）
      const deadline = performance.now() + 20_000;
      while (!document.querySelector('.graph-canvas[data-node-count]') && performance.now() < deadline) {
        await new Promise<void>((r) => setTimeout(r, 50));
      }
      return {
        ms: Math.round(painted - t0),
        canvasMs: Math.round(performance.now() - t0),
        error: '',
      };
    });
    const sample = await stopSampling(page);

    console.log('[motion-fps] 路由切换 /board → /map', JSON.stringify({ ...nav, ...sample }));
    expect(nav.error).toBe('');
    expect(nav.ms).toBeGreaterThan(0);
  });

  /**
   * 基线：关卡段推进（现在的**硬切**）。
   *
   * `LevelPage.tsx:665` 的 `onClick={() => setFlow(advance(spec, flow))}`。
   * 量「点击 → 新段落首帧」，并数一下这一段里有多少 DOM 节点被换掉
   * （用 `MutationObserver` 统计 childList 变更数）——「硬切」的观感来自
   * 旧内容整体消失、新内容整体出现，这个数字是它的代理指标。
   */
  test('基线：关卡「进入下一段」硬切耗时', async ({ page }) => {
    await installSampler(page);
    await page.goto('/level/lv-bool-laws');
    await page.waitForLoadState('networkidle');
    // 段落标题形如「第 3 段 · 简单问题」。P3 档直接从第 3 段开始，
    // 所以不能写死「第 1 段」——用正则匹配「第 N 段」。
    await page.waitForSelector('text=/第 \\d+ 段 ·/', { timeout: 30_000 });
    await page.waitForTimeout(800);

    /**
     * 先把本段的题答掉：`进入下一段` 在段内没答完时是 `disabled` 的
     * （`LevelPage.tsx:666` 的 `disabled={!complete}`）。不答题就永远等不到
     * 可点击的按钮 —— 第一次写这条时就是这么挂掉的。
     *
     * 用 Playwright 的真实鼠标点，不用 `el.click()`：Fluent 的 `Radio` 靠
     * 原生 `change` 事件驱动 `onChange`，脚本里合成的 click 不产生它
     * （实测点了之后「提交答案」仍是 disabled）。
     */
    const radios = page.locator('[role="radio"]');
    if ((await radios.count()) > 0) {
      // Fluent 的 Radio 把真正的 `<input type="radio">` 藏在视觉圆点下面，
      // 点 `[role="radio"]` 的外层 div 不触发 `change`。直接 `check` 内层
      // input（force 跳过可见性检查）才真的会改 React 状态。
      await page.locator('input[type="radio"]').first().check({ force: true });
      await page.waitForTimeout(200);
    } else {
      const ta = page.locator('textarea[aria-label="答案填空"]');
      if ((await ta.count()) > 0) await ta.fill('A');
    }
    const submit = page.getByRole('button', { name: '提交答案' });
    if ((await submit.count()) > 0) {
      await submit.first().click();
      await page.waitForTimeout(600);
    }
    // 提交后如果还有下一题（quiz 段有两道），继续答到按钮可点为止
    for (let round = 0; round < 6; round += 1) {
      const nextBtn = page.getByRole('button', { name: '进入下一段' });
      if ((await nextBtn.count()) > 0 && (await nextBtn.first().isEnabled())) break;
      const more = page.locator('input[type="radio"]:not(:checked)');
      if ((await more.count()) > 0) await more.first().check({ force: true });
      const submit2 = page.getByRole('button', { name: '提交答案' });
      if ((await submit2.count()) > 0) {
        try {
          await submit2.first().click({ timeout: 3_000 });
        } catch {
          /* 已提交过就跳过 */
        }
      }
      await page.waitForTimeout(500);
    }

    await startSampling(page);
    const cut = await page.evaluate(async () => {
      /**
       * Griffel（`makeStyles`）生成的类名是 `f1abc2de` 这种哈希，**不含**
       * `sectionTitle` 这样的语义名 —— 用 `[class*="sectionTitle"]` 选不到
       * 任何东西（第一次写时 `before`/`after` 都是空串）。改按文案认：
       * 找文本匹配 `第 N 段 · …` 且没有元素子节点的那个节点。
       */
      const titleOf = (): string => {
        const all = Array.from(document.querySelectorAll<HTMLElement>('span, div, p, h2, h3'));
        for (const el of all) {
          const text = (el.textContent ?? '').trim();
          if (/^第 \d+ 段 · /.test(text) && !el.querySelector('*')) return text;
        }
        return '';
      };
      const before = titleOf();
      let mutations = 0;
      let removed = 0;
      let added = 0;
      const obs = new MutationObserver((records) => {
        for (const r of records) {
          mutations += 1;
          removed += r.removedNodes.length;
          added += r.addedNodes.length;
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });

      const btn = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => (b.textContent ?? '').includes('进入下一段'),
      );
      if (!btn) {
        obs.disconnect();
        return { error: '没找到「进入下一段」按钮', ms: -1, before, after: before, mutations: 0, removed: 0, added: 0, disabled: null };
      }
      if (btn.disabled) {
        obs.disconnect();
        return { error: '「进入下一段」仍是 disabled（本段题没答完）', ms: -1, before, after: before, mutations: 0, removed: 0, added: 0, disabled: true };
      }
      const t0 = performance.now();
      btn.click();
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const ms = performance.now() - t0;
      // 再等一拍，让 MutationObserver 的回调跑完
      await new Promise<void>((r) => setTimeout(r, 0));
      obs.disconnect();
      return {
        error: '',
        ms: Math.round(ms),
        before,
        after: titleOf(),
        mutations,
        removed,
        added,
        disabled: false,
      };
    });
    const sample = await stopSampling(page);

    console.log('[motion-fps] 关卡段推进', JSON.stringify({ ...cut, ...sample }));
    expect(cut.error).toBe('');
    expect(cut.ms).toBeGreaterThan(0);
  });

  /**
   * 主测量：`/map` 全量 3086 节点，连续缩放。
   *
   * 用两条路径驱动，因为它们的成本结构不同：
   *
   * - **滚轮**（`measure 连续缩放`）：sigma 的滚轮缩放是**逐帧即时生效**
   *   （不是补间动画），等价于「每帧 ratio 都变」。实测 8 次滚轮把 ratio
   *   从 `1.000` 一路压到 `0.020`（= `minCameraRatio`）—— 确认滚轮真的在
   *   改相机，不是没生效。
   * - **＋/－ 按钮**（`measure 按钮缩放动画`）：走 `camera.zoomIn/zoomOut`，
   *   是 sigma 自带的补间动画，与 t60 的 `camera.animate()` 同一条通道。
   *
   * 两条合起来才能覆盖「连续缩放镜头」的两种实现方式。
   */
  test('测量：/map 3086 节点连续缩放（滚轮，逐帧改 ratio）', async ({ page }) => {
    await installSampler(page);
    await page.goto('/map');
    const nodeCount = await waitForCanvas(page);
    // 等布局收敛（LAYOUT_BUDGET_MS = 4s）再开始，避免把布局成本算进转场
    await page.waitForTimeout(5_000);

    const canvas = page.locator('.graph-canvas').first();
    const ratioBefore = await canvas.getAttribute('data-camera-ratio');

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await page.mouse.move(cx, cy);
    await startSampling(page);
    // 连续 12 次滚轮 = 一次「连续缩放镜头」的负载
    for (let i = 0; i < 12; i += 1) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(WINDOW_MS - 600);
    const sample = await stopSampling(page);

    const ratio = await canvas.getAttribute('data-camera-ratio');
    console.log(
      '[motion-fps] /map 连续缩放（滚轮）',
      JSON.stringify({ nodeCount, ratioBefore, ratio, ...sample }),
    );
    expect(nodeCount).toBeGreaterThan(3000);
    expect(sample.frames).toBeGreaterThan(10);
    // 相机确实动了 —— 否则这条测的就不是缩放
    expect(ratio).not.toBe(ratioBefore);
  });

  /**
   * 按钮缩放：`camera.zoomIn()` 是**补间动画**（默认 `AnimateOptions`
   * 时长 200ms），与 t60 要用的 `camera.animate()` 走同一个 `runAnimation`
   * → 每帧 `emit('updated')` → 重绘。这是现有代码里最贴近目标负载的一条。
   */
  test('测量：/map 按钮缩放动画（camera.zoomIn 补间）', async ({ page }) => {
    await installSampler(page);
    await page.goto('/map');
    const nodeCount = await waitForCanvas(page);
    await page.waitForTimeout(5_000);

    const canvas = page.locator('.graph-canvas').first();
    const ratioBefore = await canvas.getAttribute('data-camera-ratio');

    await startSampling(page);
    // 放大 3 次（每次 200ms 补间）再缩小 3 次，覆盖双向
    for (let i = 0; i < 3; i += 1) {
      await page.getByRole('button', { name: '放大图谱' }).click();
      await page.waitForTimeout(300);
    }
    // 记一次中间值：放大 3 次后若再缩小 3 次，ratio 会回到起点（对称），
    // 只在末尾读会误判成「按钮没生效」—— 第一次就是这么写错的。
    const ratioZoomedIn = await canvas.getAttribute('data-camera-ratio');
    for (let i = 0; i < 3; i += 1) {
      await page.getByRole('button', { name: '缩小图谱' }).click();
      await page.waitForTimeout(300);
    }
    const sample = await stopSampling(page);

    const ratio = await canvas.getAttribute('data-camera-ratio');
    console.log(
      '[motion-fps] /map 按钮缩放动画',
      JSON.stringify({ nodeCount, ratioBefore, ratioZoomedIn, ratio, ...sample }),
    );
    expect(sample.frames).toBeGreaterThan(10);
    expect(ratioZoomedIn).not.toBe(ratioBefore);
  });

  /**
   * 稳态对照：同一页面上**什么都不做**的帧率。
   *
   * 与上一条相减，才分得清「缩放本身贵」还是「这个页面空转就贵」。
   */
  test('测量：/map 3086 节点静止（稳态对照）', async ({ page }) => {
    await installSampler(page);
    await page.goto('/map');
    await waitForCanvas(page);
    await page.waitForTimeout(5_000);

    await startSampling(page);
    await page.waitForTimeout(WINDOW_MS);
    const sample = await stopSampling(page);

    console.log('[motion-fps] /map 静止', JSON.stringify(sample));
    expect(sample.frames).toBeGreaterThan(10);
  });

  /**
   * **最接近 t60 目标的现成动画**：换焦点时 `GraphCanvas.tsx:478` 的
   * `camera.animate({x, y}, {duration: 350})`。
   *
   * 它与 `useCinematicZoom()` 走的是同一条 sigma 动画通道（同一个
   * `runAnimation` → 每帧 `emit('updated')` → 重绘），唯一的差别是它**只平移
   * 不改 ratio**。所以这条测出来的帧率，就是「如果只做平移镜头」的上界；
   * 而「连续缩放」额外多出来的成本（每帧重算节点屏幕尺寸、重排标签）要靠
   * 上面的滚轮测量来补。
   *
   * 触发方式用页面自己的「以谁为中心」下拉框 —— 这是用户真实路径，也避开
   * 了「没有 sigma 句柄」的问题。
   */
  test('测量：/map 焦点切换的相机平移（350ms，sigma 原生动画）', async ({ page }) => {
    await installSampler(page);
    await page.goto('/map');
    const nodeCount = await waitForCanvas(page);
    await page.waitForTimeout(5_000);

    const picker = page.locator('select[aria-label="选择焦点知识点"]');
    expect(await picker.count()).toBe(1);
    const options = await picker.locator('option').evaluateAll((els) =>
      els.map((e) => (e as HTMLOptionElement).value).filter((v) => v !== ''),
    );
    expect(options.length).toBeGreaterThan(3);

    await startSampling(page);
    // 连续换三个焦点：每次都会触发一次 350ms 的相机动画
    for (const value of options.slice(0, 3)) {
      await picker.selectOption(value);
      await page.waitForTimeout(500);
    }
    const sample = await stopSampling(page);

    console.log('[motion-fps] /map 焦点切换相机平移', JSON.stringify({ nodeCount, ...sample }));
    expect(sample.frames).toBeGreaterThan(10);
  });
});
