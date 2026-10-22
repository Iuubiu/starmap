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
/**
 * 每次 run 用自己的输出目录。
 *
 * Playwright 在 start 时会**清空 `outputDir`**，而默认值是所有 run 共享的
 * `test-results/`。多个 agent 在同一个 checkout 上并行跑 e2e 时，A 的清理会
 * 删掉 B 正在写的 trace，B 的 `browserContext.close` 抛
 * `ENOENT ... traces/*.trace`，整个 context 崩掉，它后面的用例连带全红 ——
 * 症状是「失败的那条每次都换」，看起来像随机 flake，实际是共享目录互相踩。
 *
 * 所以目录名带上 pid：同一台机器上的每个 run 各清各的。
 * `test-results/` 在 .gitignore 里，这些产物不会进版本库。
 * 想指定固定位置时用 `--output=<dir>` 或环境变量 `PLAYWRIGHT_OUTPUT_DIR`。
 */
const outputDir =
  process.env.PLAYWRIGHT_OUTPUT_DIR ?? `test-results/run-${process.pid}`;

export default defineConfig({
  testDir: './e2e',
  outputDir,
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
