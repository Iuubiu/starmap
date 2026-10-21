/**
 * 等页面「静下来」：所有 `role=progressbar` 都消失。
 *
 * 从 `stages-impl.ts` 抽出来单独一个文件，是因为 `probe` 阶段要用它，而
 * `stages-impl.ts` 又要 import `probe` 阶段 —— 两者互相 import 会成环，
 * `pnpm check:boundaries` 的 `no-circular` 会直接报错。抽成叶子模块后
 * 依赖方向是 `stages-impl → stage-probe → settle`，单向。
 *
 * ## 为什么需要它（这是实测出来的缺陷，不是预防性措施）
 *
 * `readHeading(page)` 等的是 `<h1>` 可见，但 h1 往往是**静态标题** —— 它在
 * `usePlacementStatus()` 还是 `isPending` 时就渲染了，加载分支只替换 h1 下面的内容。
 * 于是「H1 已可见」与「页面已就绪」之间差着一个网络往返。
 *
 * 定级页实测时间线：
 *
 * ```
 * t=572ms  h1「初始定级」可见
 * t=572ms  行为自评 group  isVisible = false   ← 页面还在加载态
 * t=572ms  开始/重新定级按钮 isVisible = false  ← 同一个原因
 * t=572ms  body 尾部 = "… 正在读取你的档位…"
 * t=900ms  "正在读取你的档位…" 消失，按钮出现
 * ```
 *
 * 原代码在 572ms 那一刻各问了一次「现在可见吗」，两次都答 false，直接判
 * `locator_failure` —— 报告里因此出现一条**不成立的 blocker**。
 *
 * ## 为什么用 `role=progressbar` 而不是等具体元素
 *
 * Fluent 的 Spinner 自带这个角色，且带可访问名。按角色等不依赖任何页面的
 * 具体措辞，也不需要在每个阶段里重复写「本阶段的就绪元素是什么」。
 *
 * ## 超时不报错
 *
 * 超时了就返回 —— 后面的显式检查会自己报出「没找到 X」。把「等不静」也报成
 * `locator_failure` 会把两种不同的原因（真的没有 vs 一直在转圈）揉成一个。
 *
 * ## 上限为什么是 20 秒
 *
 * 卡的不是应用状态，是渲染：`/map` 要等上千个叶节点回来再建 sigma 的 WebGL
 * 画布，本机无 GPU 走 SwiftShader，实测 `goto` 到清单首项可见 6–11 秒。
 */

import type { Page } from '@playwright/test';

/** 等页面静下来的默认上限。 */
export const SETTLE_TIMEOUT = 20_000;

export async function waitForSettled(page: Page, timeout = SETTLE_TIMEOUT): Promise<void> {
  const spinners = page.getByRole('progressbar');
  const deadline = Date.now() + timeout;
  /* 先让出一帧：刚 goto 完时 Spinner 可能还没挂上，立刻查会得到 0 个而误判
     为「已经静下来」。 */
  await page.waitForTimeout(150);
  while (Date.now() < deadline) {
    if ((await spinners.count().catch(() => 0)) === 0) return;
    await spinners
      .first()
      .waitFor({ state: 'hidden', timeout: 1000 })
      .catch(() => undefined);
    await page.waitForTimeout(80);
  }
}
