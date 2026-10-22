import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // 集成测试共用同一个 Postgres 实例，但各自建独立 schema，
    // 所以可以并行；单文件内串行即可。
    pool: 'forks',
  },
});
