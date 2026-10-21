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
 * 修法是先等页面静下来（没有 `role=progressbar`）再问可见性。这条测试就是
 * 钉住那个「先等」：如果谁把 `waitForSettled` 从阶段里删掉、或者把它改成
 * 不等 Spinner，这里会红。
 *
 * ## 为什么不用真浏览器
 *
 * 这条测试要断言的是**时序**，不是渲染。用真的 Playwright 就得起浏览器、
 * 起 dev server、还得让后端在 328ms 那一刻确实没返回 —— 那样测的是环境的
 * 时序抖动，跑十次红三次。假 Page 可以把「572ms 时还在转圈、900ms 才静」
 * 这件事写成确定性的，于是它测的才是驱动逻辑本身。
 */

import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import { waitForSettled } from '../src/layer2/stages-impl.ts';

/**
 * 造一个只实现 `waitForSettled` 用到的四个方法的假 Page。
 *
 * `spinnerUntilMs`：从开始计时到这一刻为止，`role=progressbar` 一直存在。
 * 时间用虚拟时钟推进，不真的 sleep —— 否则这条测试要跑 900ms。
 */
function fakePage(options: { spinnerUntilMs: number }): { page: Page; clock: () => number } {
  let now = 0;
  const spinnerGone = (): boolean => now >= options.spinnerUntilMs;

  const locator = {
    count: async () => (spinnerGone() ? 0 : 1),
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
  };

  const page = {
    getByRole: () => locator,
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
});
