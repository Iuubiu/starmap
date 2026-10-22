/**
 * `waitForSettled()` 的回归测试。
 *
 * ## 这条测试防的是什么
 *
 * 定级页（`apps/web/src/pages/PlacementPage.tsx`）的 `<h1>初始定级</h1>` 是
 * **静态标题**：`usePlacementStatus()` 还在 `isPending` 时它就已经渲染了，
 * 加载分支只替换 h1 下面的内容。实测时间线：
 *
 * ```
 * t=572ms  h1「初始定级」可见
 * t=572ms  行为自评 group  isVisible = false   ← 页面还在加载态
 * t=572ms  开始/重新定级按钮 isVisible = false  ← 同一个原因
 * t=572ms  body 尾部 = "… 正在读取你的档位…"
 * t=900ms  "正在读取你的档位…" 消失，按钮出现
 * ```
 *
 * 原来的驱动在 572ms 那一刻各问一次「现在可见吗」，两次都答 false，直接判
 * `locator_failure` —— 报告里因此出现一条**不成立的 blocker**，而且它是唯一
 * 一条，导致「阻塞项 1 条」这个结论整个是假的。
 *
 * ## 第二条要防的：把**量尺**当成 loading
 *
 * `apps/web/src/agent/ProbePanel.tsx` 用 `ProgressBar value={level/cap}` 画
 * 「提示等级 1/5」。探针面板打开时抓 DOM 实测：
 *
 * ```json
 * [{"label":"提示等级 1，上限 5","now":"0.2","max":"1"}]
 * ```
 *
 * 它带 `aria-valuenow`，是**定值**量尺，会一直在页面上。如果「静下来」的判据是
 * 「页面上没有任何 `role=progressbar`」，那么任何开着探针面板的页面都永远
 * 静不下来：20 场景里的「刷新后仍可用」因此恒红，`probe` 阶段也会得到一条
 * 不成立的 `locator_failure`。所以判据必须是「没有**不确定态** progressbar」。
 *
 * ## 为什么不用真浏览器
 *
 * 这两条测试要断言的是**时序**与**判据**，不是渲染。用真的 Playwright 就得
 * 起浏览器、起 dev server、还得让后端在 328ms 那一刻确实没返回 —— 那样测的是
 * 环境的时序抖动，跑十次红三次。假 Page 可以把「572ms 时还在转圈、900ms 才静」
 * 写成确定性的，于是它测的才是驱动逻辑本身。
 */

import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import { waitForSettled } from '../src/layer2/stages-impl.ts';

/** 只数「不确定态」progressbar 的选择器（与 settle.ts 里的 PENDING_BARS 同义）。 */
const PENDING_SELECTOR = '[role="progressbar"]:not([aria-valuenow])';

/**
 * 造一个只实现 `waitForSettled` 用到的四个方法的假 Page。
 *
 * `spinnerUntilMs`：从开始计时到这一刻为止，**不确定态** progressbar 一直存在。
 * `determinateBars`：页面上恒定存在的**定值**进度条数量（模拟 `ProbePanel`
 * 的「提示等级 1/5」）。它永远不消失，且**不该**参与「静下来」的判定。
 * 时间用虚拟时钟推进，不真的 sleep —— 否则这条测试要跑 900ms。
 */
function fakePage(options: {
  spinnerUntilMs: number;
  determinateBars?: number;
}): { page: Page; clock: () => number } {
  let now = 0;
  const determinateBars = options.determinateBars ?? 0;
  const spinnerGone = (): boolean => now >= options.spinnerUntilMs;

  const makeLocator = (pending: boolean) => ({
    count: async () => (pending ? (spinnerGone() ? 0 : 1) : determinateBars),
    first: () => ({
      waitFor: async ({ state, timeout }: { state: string; timeout?: number }) => {
        if (state === 'hidden') {
          /* 真实 Playwright 会阻塞到元素消失或超时。这里按虚拟时钟推进，
             模拟「等到 spinnerUntilMs 就消失」。 */
          const wait = Math.max(0, options.spinnerUntilMs - now);
          if (timeout !== undefined && wait > timeout) {
            now += timeout;
            throw new Error('Timeout');
          }
          now += wait;
          return;
        }
        return;
      },
    }),
  });

  const page = {
    /* `:not([aria-valuenow])` 的那个才是「还在转圈」的；不带 `:not` 的宽选择器
       是历史写法，这里让它数到定值条 —— 用来证明新判据确实没再走它。 */
    locator: (selector: string) => makeLocator(selector.includes(':not([aria-valuenow])')),
    getByRole: () => makeLocator(true),
    waitForTimeout: async (ms: number) => {
      now += ms;
    },
  } as unknown as Page;

  return { page, clock: () => now };
}

describe('waitForSettled：等页面不再转圈', () => {
  it('Spinner 一直在时不会立刻返回 —— 这正是把加载态误判成 locator_failure 的根因', async () => {
    const { page, clock } = fakePage({ spinnerUntilMs: 900 });
    await waitForSettled(page, 5_000);
    /* 返回时一定已经过了 Spinner 消失的时刻。原实现（不等 Spinner）会在
       t≈0 就返回，于是紧随其后的 isVisible() 读到 false。 */
    expect(clock()).toBeGreaterThanOrEqual(900);
  });

  it('页面一开始就静的时候不会白等 —— 正常页面不该为此付出 30 秒', async () => {
    const { page, clock } = fakePage({ spinnerUntilMs: 0 });
    await waitForSettled(page, 5_000);
    /* 只让出一帧（150ms 的让出 + 一轮 80ms 检查）。 */
    expect(clock()).toBeLessThan(500);
  });

  it('Spinner 永远不消失时到点返回，不抛异常', async () => {
    const { page, clock } = fakePage({ spinnerUntilMs: Number.POSITIVE_INFINITY });
    await expect(waitForSettled(page, 400)).resolves.toBeUndefined();
    expect(clock()).toBeGreaterThanOrEqual(400);
  });

  it('定值进度条（提示等级 1/5）不该让页面永远静不下来', async () => {
    /* 模拟 `ProbePanel` 打开的页面：没有不确定态 Spinner，但有一条永远在的
       定值进度条。旧判据会在这里等满超时，新判据必须立刻返回。 */
    const { page, clock } = fakePage({ spinnerUntilMs: 0, determinateBars: 1 });
    await waitForSettled(page, 5_000);
    expect(clock(), '定值进度条不该被当成 loading').toBeLessThan(500);
  });

  it('判据确实是「不确定态」而不是「任何 progressbar」', async () => {
    /* 把 PENDING_SELECTOR 的语义固定下来：改判据的人会先在这里看到红。 */
    expect(PENDING_SELECTOR).toContain(':not([aria-valuenow])');
    const { page, clock } = fakePage({ spinnerUntilMs: 700, determinateBars: 2 });
    await waitForSettled(page, 5_000);
    expect(clock(), '有定值条时仍要等真正的不确定态消失').toBeGreaterThanOrEqual(700);
  });
});
