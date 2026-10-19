import { defineConfig, devices } from '@playwright/test';

/**
 * E2E 配置。
 *
 * **两个 webServer 都必须起。** 一开始这里只起 Vite，注释写着「后端由环境
 * 自己保证已在 3001 运行」—— 结果是只要没手动开后端，5 个用例全部超时，
 * 报错还是「元素找不到」，看起来像前端 bug。E2E 必须能独立跑起来，
 * 否则它就只是「在我这台机器上此刻能过」的幻觉。
 *
 * 后端连真实 Postgres（不是测试替身），所以这里测的是真链路：
 * Vite → NestJS → Postgres → 页面。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @starmap/api dev',
      url: 'http://127.0.0.1:3001/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      cwd: '../..',
    },
    {
      command: 'npx vite --port 5173',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
