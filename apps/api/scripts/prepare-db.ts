/**
 * 起服务之前，把待执行的迁移应用掉。
 *
 * 为什么是一个独立的脚本、由 `package.json` 的 `dev` / `start` 用 `&&` 串起来，
 * 而不是写在 `src/main.ts` 的 bootstrap 里：
 *
 * - `src/main.ts` 不在 t75 的 inScope 里（那条线只许碰启动脚本、迁移执行器、
 *   文档与新测试）。用脚本串起来能在**不改业务入口**的前提下覆盖全部起服务的
 *   路径：`pnpm dev`（根 `scripts/dev.mjs` 调的是 `--filter @starmap/api dev`）、
 *   `pnpm dev:api`、`pnpm start`、以及 Playwright 的 webServer（它跑的也是
 *   `pnpm --filter @starmap/api dev`）。四条路最终都落到这两个 npm script，
 *   所以串在这两个 script 前面就全覆盖。
 * - 失败即退出：`&&` 保证迁移失败时后面的 dev server 根本不启动、退出码非零。
 *   带着半套 schema 起服务，第一次查询会报 `column ... does not exist`，
 *   看起来像业务代码 bug，排查成本远高于启动失败。
 * - 只有 `dev` / `start` 需要它。`db:migrate` / `db:rollback` / `db:seed`
 *   本身就是迁移命令，不该在它们前面再跑一遍。
 *
 * 幂等由执行器保证（`apps/api/src/db/migrate.ts`）：已应用的版本记在
 * `app.schema_migrations` 里，重复启动只会打印「已是最新」。
 *
 * 日志用 `console` 而不是 `@nestjs/common` 的 Logger：这条路径在 Nest 起来
 * 之前就要跑，而且 `@nestjs/common` 在 package.json 里是 devDependency，
 * 迁移不该依赖一个可能被 prune 掉的包。
 */
import { migrateUp } from '../src/db/migrate.js';

async function main(): Promise<void> {
  try {
    await migrateUp({ log: (line) => console.log(`[Migrate] ${line.trim()}`) });
  } catch (err) {
    console.error(
      `[PrepareDb] 迁移失败，服务不启动：${err instanceof Error ? err.message : String(err)}\n` +
        '  检查 PostgreSQL 是否在跑、.env 里的 DATABASE_URL 是否可连。',
    );
    process.exitCode = 1;
  }
}

void main();
