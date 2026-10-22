import { defineConfig, devices } from '@playwright/test';

/**
 * QA 场景套件配置（票 20 / t43 浏览器深度验收）。
 *
 * 为什么单独一份而不是复用 `apps/web/playwright.config.ts`：
 *   1. 那份的 `testDir` 是 `./e2e`，场景放在 `.scratch/qa/scenarios/`；
 *   2. 那份会 `webServer` 起后端与 Vite —— 本套件跑的是**已经在跑的开发服务**
 *      （captain 起好并验证过），重复起会撞端口；
 *   3. 那份 `fullyParallel: false` + `workers: 1`，本套件同样串行（共享真实库，
 *      并行会互相污染掌握度/会话）。
 *
 * 跑法（**必须带 --output**，默认 test-results 会被并发 run 互相清空）：
 *
 *     cd apps/web
 *     npx playwright test --config=../../.scratch/qa/playwright.config.ts \
 *       --output=../../.scratch/pw-qa-$(date +%s)
 */
export default defineConfig({
  testDir: './scenarios',
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? '../../.scratch/pw-qa-default',
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
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
