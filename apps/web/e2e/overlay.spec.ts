/**
 * 票 68 的端到端验证：关卡以**浮层**呈现、背景页不卸载、URL 不变、
 * 输入框草稿还在，以及两段动效在真浏览器里的实测值。
 *
 * ## 为什么必须用真浏览器
 *
 * 这一票的核心断言全都依赖 jsdom 没有的东西：
 * - `backdrop-filter` 的计算值（jsdom 不算样式，`getComputedStyle` 只会原样回读声明）；
 * - WAAPI 的**中间帧**（`element.getAnimations()` 的 `currentTime` 与
 *   `effect.getKeyframes()`，jsdom 没有合成器，`animate()` 根本不存在）；
 * - `inert` 的实际拦截效果（焦点能否真的走不进背景页）；
 * - CLS（`PerformanceObserver` 的 `layout-shift` 只在真渲染里产生）。
 *
 * ## 怎么在不改产品代码的前提下「从对话里打开一关」
 *
 * 设计文档 §6 把**触发时机**划给了 t69（`useAutoOpenLevel` 看对话产物），本票
 * 只负责「被要求打开时容器与动效正确」。所以这里不去模拟一整轮对话，而是直接
 * 在页面里调门面 —— 这正是 t69 将来会调的那一个函数，不是测试专用的后门：
 *
 * ```ts
 * const { openLevel } = await import('/src/level/open.ts');
 * openLevel('lv-bool-laws');
 * ```
 *
 * 走 Vite 的源码 URL 动态 import，拿到的是**同一份模块实例**（与
 * `apps/web/src/motion/qaHarness.tsx` 同一条思路：让探针在真实模块图上操作，
 * 而不是再造一个平行的世界）。
 *
 * 跑法（先确保 api:3001 与 web:5173 都在跑）：
 *   cd apps/web && npx playwright test e2e/overlay.spec.ts \
 *     --output=../../.scratch/pw-overlay-$(date +%s)
 */
import { expect, test, type Page } from '@playwright/test';

/** Vite 默认只绑 `::1`，用 `localhost` 才连得上（打 `127.0.0.1:5173` 会 refused）。 */
const WEB = 'http://localhost:5173';

/** 会话首页：有输入框、有对话区，正是「打开浮层时不该被卸载」的那一页。 */
const CHAT_PATH = '/';

/** 真库里必然存在的一关（`system` 作者、`isEntry`）。 */
const LEVEL_ID = 'lv-bool-laws';

/**
 * 等页面稳定。
 *
 * 首页会先拉几个 query，`textarea` 出现就说明主体已经挂上了 —— 比等
 * `networkidle` 稳（后者在有长轮询/流式响应的页面上会一直不 idle）。
 *
 * ## 为什么要先塞 `profileDone`
 *
 * `apps/web/src/routes.tsx` 把 `/` 包在 `FirstVisitGate` 里：没走过「初识」时
 * 直接 `<Navigate to="/welcome" replace />`（`apps/web/src/pages/WelcomePage.tsx`
 * 的 `isProfileDone()` 只认 `localStorage.profileDone === '1'`）。全新浏览器
 * 上下文里那个键不存在，所以 `goto('/')` 落地的是欢迎页，永远等不到输入框。
 * 这里用 `addInitScript` 在页面脚本之前写入标记 —— 这是「假装这个学生已经
 * 走过初识」，不是在绕过被测逻辑。
 */
async function openChat(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('profileDone', '1');
  });
  await page.goto(`${WEB}${CHAT_PATH}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('textarea[aria-label="这一轮想说的话"]')).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * 通过门面打开浮层。
 *
 * 注意 `import(...)` 的路径必须带 `.ts` 后缀 —— Vite dev 的模块图按真实文件
 * 解析，`/src/level/open` 会 404。
 */
async function openLevelFromFacade(page: Page, levelId: string): Promise<void> {
  await page.evaluate(async (id) => {
    /**
     * 路径放在变量里而不是字面量：`import('/src/level/open.ts')` 是 Vite dev
     * 的源码 URL，TypeScript 的模块解析器不认识它（会报 TS2307）。转成变量后
     * TS 不再静态解析，运行时仍由 Vite 按真实文件解析。
     */
    const modulePath = '/src/level/open.ts';
    const module = (await import(/* @vite-ignore */ modulePath)) as {
      openLevel: (levelId: string) => void;
    };
    module.openLevel(id);
  }, levelId);
}

/** 读浮层当前的阶段（`data-overlay-phase` 由组件写在面板上）。 */
async function overlayPhase(page: Page): Promise<string | null> {
  return page.locator('.level-overlay-panel').getAttribute('data-overlay-phase');
}

test.describe('关卡浮层（票 68）', () => {
  test.describe.configure({ timeout: 120_000 });

  test('从对话打开一关：URL 不变、页面不卸载、草稿还在', async ({ page }) => {
    await openChat(page);

    // 先打一段草稿 —— 这是「浮层不整页跳转」最容易被感知的证据。
    const composer = page.locator('textarea[aria-label="这一轮想说的话"]');
    await composer.fill('浮层打开之后这段话必须还在');

    const urlBefore = page.url();
    const mainBefore = await page.locator('main').count();

    await openLevelFromFacade(page, LEVEL_ID);
    await expect(page.locator('.level-overlay-panel')).toBeVisible({ timeout: 30_000 });

    // 1) URL 一个字都没变
    expect(page.url()).toBe(urlBefore);
    // 2) 背景页还在（`main` 没被卸载），只是 inert
    expect(await page.locator('main').count()).toBe(mainBefore);
    // 3) 草稿还在，而且是同一段文字
    await expect(composer).toHaveValue('浮层打开之后这段话必须还在');
    // 4) 背景确实被设为 inert（不是 display:none —— 那样输入框就看不见了）
    const rootInert = await page.evaluate(() => document.getElementById('root')?.hasAttribute('inert'));
    expect(rootInert).toBe(true);
    // 5) 输入框**仍然可见**（inert 不影响渲染）
    await expect(composer).toBeVisible();
  });

  test('浮层是无障碍意义上的模态对话框', async ({ page }) => {
    await openChat(page);
    await openLevelFromFacade(page, LEVEL_ID);

    const dialog = page.locator('.level-overlay-panel');
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toHaveAttribute('role', 'dialog');

    // aria-labelledby 指向的标题必须真实存在且非空。
    const labelId = await dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    const title = page.locator(`#${labelId}`);
    await expect(title).toBeVisible();
    await expect(title).not.toHaveText('');

    // 打开后焦点在面板容器上，不是第一个按钮。
    const focusedIsPanel = await page.evaluate(() =>
      document.activeElement?.classList.contains('level-overlay-panel'),
    );
    expect(focusedIsPanel).toBe(true);
  });

  test('遮罩：blur ≥ 8px，两套主题各自的遮罩色', async ({ page }) => {
    await openChat(page);

    const readScrim = async (): Promise<{ blur: number; background: string }> =>
      page.evaluate(() => {
        const scrim = document.querySelector('.level-overlay-scrim');
        if (scrim === null) return { blur: -1, background: '' };
        const style = getComputedStyle(scrim);
        const filter = style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter');
        const match = /blur\(([\d.]+)px\)/.exec(filter);
        return {
          blur: match === null ? 0 : Number(match[1]),
          background: style.backgroundColor,
        };
      });

    // 遮罩色必须由主题决定。先显式钉到深色读一次，再钉到亮色读一次 ——
    // 不依赖「默认是深色」（`mode: 'system'` 时默认跟随操作系统，Playwright
    // 的默认 colorScheme 是 light，硬等深色会读到亮色值）。
    await openLevelFromFacade(page, LEVEL_ID);
    await expect(page.locator('.level-overlay-panel')).toBeVisible({ timeout: 30_000 });

    const withTheme = async (theme: 'dark' | 'light') => {
      await page.evaluate((name) => {
        document.documentElement.dataset.smTheme = name;
        document.documentElement.dataset.smMode = name;
      }, theme);
      return readScrim();
    };

    const dark = await withTheme('dark');
    const light = await withTheme('light');

    // 两套主题各自的遮罩色：不允许同一个 rgba 硬套两边。
    expect(dark.background).toMatch(/^rgba?\(/);
    expect(light.background).toMatch(/^rgba?\(/);
    expect(light.background).not.toBe(dark.background);
    // 模糊在两套主题下都成立（这条是「降级的是配色，不是可见性」）。
    expect(dark.blur).toBeGreaterThanOrEqual(8);
    expect(light.blur).toBeGreaterThanOrEqual(8);
  });

  test('弹出动画：opacity 0→1、scale .96→1、translateY 16px→0，standard + easeOut', async ({
    page,
  }) => {
    await openChat(page);
    await openLevelFromFacade(page, LEVEL_ID);
    const panel = page.locator('.level-overlay-panel');
    await expect(panel).toBeVisible({ timeout: 30_000 });

    const animation = await page.evaluate(() => {
      const node = document.querySelector('.level-overlay-panel');
      if (node === null) return null;
      const animations = node.getAnimations();
      const first = animations[0];
      if (first === undefined) return null;
      const effect = first.effect as KeyframeEffect | null;
      const timing = effect?.getTiming();
      const keyframes = effect?.getKeyframes() ?? [];
      return {
        duration: typeof timing?.duration === 'number' ? timing.duration : null,
        easing: timing?.easing ?? null,
        keyframes: keyframes.map((frame) => ({
          opacity: (frame as { opacity?: string }).opacity ?? null,
          transform: (frame as { transform?: string }).transform ?? null,
        })),
      };
    });

    expect(animation).not.toBeNull();
    // standard = 200ms，easeOut 的贝塞尔来自 motion/tokens.ts（不是字面量）。
    expect(animation!.duration).toBe(200);
    expect(animation!.easing).toBe('cubic-bezier(0.22, 1, 0.36, 1)');

    const [start, end] = animation!.keyframes;
    expect(start?.opacity).toBe('0');
    expect(start?.transform).toContain('scale(0.96)');
    expect(start?.transform).toContain('translateY(16px)');
    expect(end?.opacity).toBe('1');
    expect(end?.transform).toContain('scale(1)');
    expect(end?.transform).toContain('translateY(0px)');
  });

  test('收回动画更快（quick 120ms），且遮罩在收回期间不提前撤', async ({ page }) => {
    await openChat(page);
    await openLevelFromFacade(page, LEVEL_ID);
    await expect(page.locator('.level-overlay-panel')).toBeVisible({ timeout: 30_000 });

    // 点关闭按钮 → 立刻读动画参数与遮罩是否还在。
    await page.getByRole('button', { name: '关闭关卡' }).click();

    const during = await page.evaluate(() => {
      const node = document.querySelector('.level-overlay-panel');
      const scrim = document.querySelector('.level-overlay-scrim');
      const animation = node?.getAnimations()[0];
      const effect = animation?.effect as KeyframeEffect | null;
      const timing = effect?.getTiming();
      return {
        scrimStillThere: scrim !== null,
        panelStillThere: node !== null,
        duration: typeof timing?.duration === 'number' ? timing.duration : null,
      };
    });

    // 收回过程中面板与遮罩都还在 —— 先撤遮罩等于把面板直接怼在背景上。
    expect(during.scrimStillThere).toBe(true);
    expect(during.panelStillThere).toBe(true);
    expect(during.duration).toBe(120);

    // 播完之后真的卸载。
    await expect(page.locator('.level-overlay-panel')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator('.level-overlay-scrim')).toHaveCount(0);
  });

  test('三条关闭路径：Esc / 点遮罩 / 面板内按钮，都回到触发处', async ({ page }) => {
    await openChat(page);

    // 先给背景页一个明确的焦点落点（对话输入框）。
    const composer = page.locator('textarea[aria-label="这一轮想说的话"]');
    await composer.focus();

    for (const close of ['escape', 'scrim', 'button'] as const) {
      await openLevelFromFacade(page, LEVEL_ID);
      await expect(page.locator('.level-overlay-panel')).toBeVisible({ timeout: 30_000 });

      if (close === 'escape') {
        await page.keyboard.press('Escape');
      } else if (close === 'scrim') {
        await page.locator('.level-overlay-scrim').click({ position: { x: 8, y: 8 } });
      } else {
        await page.getByRole('button', { name: '关闭关卡' }).click();
      }

      await expect(page.locator('.level-overlay-panel')).toHaveCount(0, { timeout: 10_000 });

      // 焦点归还：回到打开前那个元素（输入框），不是 body。
      const active = await page.evaluate(() => ({
        tag: document.activeElement?.tagName ?? '',
        label: document.activeElement?.getAttribute('aria-label') ?? '',
      }));
      expect(active.label).toBe('这一轮想说的话');
      // 背景的 inert 也撤掉了，否则输入框拿不回焦点。
      const rootInert = await page.evaluate(() =>
        document.getElementById('root')?.hasAttribute('inert'),
      );
      expect(rootInert).toBe(false);
    }
  });

  test('地图 → 关卡：真驱动 sigma 相机（不是 CSS 假缩放）', async ({ page }) => {
    // 先到地图页，让 GraphCanvas 把相机挂到镜头通道上。
    await page.goto(`${WEB}/map?hops=all`, { waitUntil: 'domcontentloaded' });
    const canvas = page.locator('.graph-canvas');
    await expect(canvas).toBeVisible({ timeout: 60_000 });
    // 等画布真的画出节点（`data-node-count` 非空）—— 容器可见不代表相机已就绪。
    await expect
      .poll(
        async () => Number((await canvas.getAttribute('data-node-count')) ?? 0),
        { timeout: 60_000 },
      )
      .toBeGreaterThan(0);

    const ratioBefore = Number(await canvas.getAttribute('data-camera-ratio'));
    expect(Number.isFinite(ratioBefore)).toBe(true);

    await openLevelFromFacade(page, LEVEL_ID);
    await expect(page.locator('.level-overlay-panel')).toBeVisible({ timeout: 30_000 });

    // 相机推近：`data-camera-ratio` 变小（sigma 的 ratio 越小越近）。
    // 这条断言的力度在于：CSS 假缩放**改不动**这个属性，它只由 sigma 相机写。
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-camera-ratio')), {
        timeout: 10_000,
      })
      .toBeLessThan(ratioBefore);

    // 关掉之后拉回初始视野（ratio = 1）。
    await page.getByRole('button', { name: '关闭关卡' }).click();
    await expect(page.locator('.level-overlay-panel')).toHaveCount(0, { timeout: 10_000 });
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-camera-ratio')), {
        timeout: 10_000,
      })
      .toBeCloseTo(1, 1);
  });

  test('prefers-reduced-motion: reduce 下不播动画，但遮罩与模糊仍在', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openChat(page);

    // 记录 rAF 调用次数：reduce 的判据是「一次都没发」，不是「时长为 0」。
    await page.evaluate(() => {
      const original = window.requestAnimationFrame.bind(window);
      const counter = { count: 0 };
      (window as unknown as { __rafCount: typeof counter }).__rafCount = counter;
      window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        counter.count += 1;
        return original(callback);
      }) as typeof window.requestAnimationFrame;
    });

    await openLevelFromFacade(page, LEVEL_ID);
    const panel = page.locator('.level-overlay-panel');
    await expect(panel).toBeVisible({ timeout: 30_000 });

    // 面板上不应该挂着任何**我们发起的**动画。
    //
    // 注意 `getAnimations()` 也会返回浏览器自己生成的 `CSSTransition`
    // （这里是 `:focus-visible` 的 outline-color/offset/width 三条过渡，
    // 被 `theme/tokens.css` 的 reduce 块压到 `0.01ms`）。那些不是浮层发的，
    // 所以按「构造器是 `Animation`（WAAPI）」+「时长 > 1ms」两个条件筛。
    const animations = await page.evaluate(() => {
      const node = document.querySelector('.level-overlay-panel');
      if (node === null) return null;
      return node.getAnimations().map((animation) => {
        const effect = animation.effect;
        const timing = effect && 'getTiming' in effect ? effect.getTiming() : null;
        const duration = timing !== null && typeof timing.duration === 'number' ? timing.duration : 0;
        return { kind: animation.constructor.name, duration };
      });
    });
    expect(animations).not.toBeNull();
    expect(animations!.filter((item) => item.kind === 'Animation')).toEqual([]);
    expect(animations!.filter((item) => item.duration > 1)).toEqual([]);

    // 遮罩与模糊照常生效 —— 降级的是动效，不是可见性。
    const scrim = await page.evaluate(() => {
      const node = document.querySelector('.level-overlay-scrim');
      if (node === null) return null;
      const style = getComputedStyle(node);
      const filter = style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter');
      const match = /blur\(([\d.]+)px\)/.exec(filter);
      return { blur: match === null ? 0 : Number(match[1]), background: style.backgroundColor };
    });
    expect(scrim).not.toBeNull();
    expect(scrim!.blur).toBeGreaterThanOrEqual(8);

    // 关闭同样是瞬时的。
    await page.getByRole('button', { name: '关闭关卡' }).click();
    await expect(page.locator('.level-overlay-panel')).toHaveCount(0, { timeout: 5_000 });

    const rafCount = await page.evaluate(
      () => (window as unknown as { __rafCount: { count: number } }).__rafCount.count,
    );
    // 页面自身（React 调度、sigma 空闲刷新）也会用 rAF，所以不能断言绝对 0；
    // 但浮层自己一次都不该发 —— 这条用「面板没有动画」+「没有 WAAPI 调用」表达，
    // 这里只留一个上界，防止把整段动画退化成逐帧脚本。
    expect(rafCount).toBeLessThan(120);
  });

  test('CLS < 0.01', async ({ page }) => {
    await openChat(page);

    await page.evaluate(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
          if (!shift.hadRecentInput) {
            (window as unknown as { __cls: number }).__cls += shift.value;
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });

    await openLevelFromFacade(page, LEVEL_ID);
    await expect(page.locator('.level-overlay-panel')).toBeVisible({ timeout: 30_000 });
    // 等动画与关卡内容都落定，避免把「内容加载后的自然位移」算进来。
    await page.waitForTimeout(1_500);

    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.01);
  });
});
