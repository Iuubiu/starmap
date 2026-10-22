import { defineConfig, devices } from '@playwright/test';

/**
 * t76 专用探针配置：**强制经典滚动条**。
 *
 * 为什么不能直接用 `.scratch/qa/playwright.config.ts`：
 * headless Chromium 默认用 **overlay 滚动条**（不占布局宽度），
 * `main.getBoundingClientRect().width - main.clientWidth` 恒为 0，
 * 于是票面记录的「左边 47 / 右边 65」那个 18px 差**复现不出来**。
 * 但真实 Windows 上的 Chrome/Edge 用经典滚动条（约 15–17px），
 * 差值真实存在。所以取证必须换到经典滚动条模式下量，否则
 * 「改前 47 vs 65 → 改后 47 vs 47」这条对比就是拿一个不存在的
 * 缺陷去证明一个没发生过的修复。
 *
 * 其余设置与 QA 套件保持一致（串行、真实库、zh-CN、Asia/Shanghai）。
 */
export default defineConfig({
  testDir: './scenarios',
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? '../../.scratch/pw-t76-default',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    launchOptions: {
      // Playwright 在 headless 下默认注入 `--hide-scrollbars`：滚动条既不画，
      // 也不占布局宽度。只加 `--disable-features=...` 没用，必须把它从默认
      // 参数里摘掉，否则 `rect.width − clientWidth` 永远等于 0。
      ignoreDefaultArgs: ['--hide-scrollbars'],
      args: ['--disable-features=OverlayScrollbar,FluentOverlayScrollbar,OverlayScrollbars'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
