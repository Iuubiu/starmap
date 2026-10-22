/**
 * 迁移执行器 CLI。真正的实现在 `src/db/migrate.ts`（启动路径与测试共用同一份）。
 *
 * 这个文件只做参数分发与退出码。放在 `scripts/` 是因为 `pnpm db:migrate`
 * 需要一个可执行入口；逻辑留在 `src/` 才能被 typecheck 与集成测试覆盖。
 */
import { migrateDown, migrateUp, runSeed } from '../src/db/migrate.js';

const arg = process.argv[2];
const task =
  arg === 'down' ? migrateDown() : arg === 'seed' ? runSeed() : migrateUp();

task
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('执行失败:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
