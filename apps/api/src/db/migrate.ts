/**
 * 迁移执行器（库）。CLI 在 `apps/api/scripts/migrate.ts`，服务启动前也直接调这里。
 *
 * 为什么放在 `src/` 而不是只留在 `scripts/`：
 * 启动时应用迁移这件事必须被 typecheck 覆盖，也必须能被集成测试直接调用。
 * `apps/api/tsconfig.json` 的 `include` 只有 `src/**`，放在 scripts 里的代码
 * 是「跑得起来但没人检查」的——迁移是启动链上的第一环，不适合待在那个盲区。
 *
 * 手写而不是引 ORM 的迁移工具，因为需求只有三件事：建 schema、按序执行 SQL
 * 文件、记录已执行版本。不用事务包住整个迁移：DDL 在 Postgres 里可以进事务，
 * 但「可重复执行」的要求更适合用幂等的 `CREATE ... IF NOT EXISTS` 加版本表来
 * 判断。重复执行不报错是票 01 的硬验收项。
 *
 * 回滚用**配对的下行脚本** `<name>.down.sql`，不是猜表名。这里踩过一个坑：
 * 早先的实现把文件名当表名去 `DROP TABLE app.0001_init`，两个错误叠在一起
 * —— ① 一个迁移建 13 张表而不是 1 张；② `0001_init` 以数字开头，Postgres 里
 * 根本不是合法标识符（42601）。回滚必须由人写明怎么退，猜不出来。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MIGRATIONS_DIR = join(here, '..', '..', 'migrations');

/**
 * 与 `database.service.ts`、`scripts/check-migrations.mjs` 保持同一个 fallback。
 * 三处必须一致，否则「检查通过了但服务连的是另一个库」。
 */
export const DEFAULT_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap';

/**
 * 多实例互斥用的 advisory lock 键。
 *
 * 为什么需要：两个 api 进程同时起来（`pnpm dev` 起一个、Playwright 的 webServer
 * 又起一个、或者部署时滚动更新）会同时读版本表、同时判定「这个迁移没执行」，
 * 然后同时执行 —— 幂等的 DDL 会互相等待甚至死锁，非幂等的 INSERT 会翻倍。
 * 加锁后第二个进程会排队，醒来时版本表已经更新，于是什么都不做。
 *
 * 用固定常量而不是 `hashtext()`：后者依赖字符串哈希实现，跨版本不保证稳定，
 * 而这个值一旦变了，新旧进程会各锁各的，互斥就失效了。
 */
const ADVISORY_LOCK_KEY = '8216431905772331';

export interface MigrateOptions {
  databaseUrl?: string;
  migrationsDir?: string;
  /**
   * 目标 schema。默认 `app`。
   *
   * 非 `app` 时会把 SQL 里的 `app.` 重写成 `<schema>.`，供测试在临时 schema
   * 上真跑一遍迁移。生产路径（`app`）**不做任何改写**：在真实库上做字符串
   * 替换是最不该有的聪明。
   */
  schema?: string;
  log?: (line: string) => void;
}

export interface MigrateResult {
  /** 本次真正执行的迁移文件名 */
  applied: string[];
  /** 已执行过、本次跳过的数量 */
  skipped: number;
  /** 目录里总共多少个上行迁移 */
  total: number;
}

/** 上行脚本（不含 seed，不含 .down.sql），按文件名排序 */
export function upFiles(migrationsDir: string = DEFAULT_MIGRATIONS_DIR): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => !f.startsWith('seed'))
    .filter((f) => !f.endsWith('.down.sql'))
    .sort();
}

/**
 * 把迁移 SQL 从 `app.` 重定向到目标 schema。
 *
 * 与 `test/test-schema.ts` 同一套规则（那里是测试基建，这里是执行器；两边都
 * 不能省这道闸）。`replaceAll('app.', …)` 只能改写带点的引用，任何不带点的
 * 「app」都会落到真实数据库上 —— 例如 `0001_init.down.sql` 末尾的
 * `DROP SCHEMA IF EXISTS app CASCADE`。遇到就抛错，绝不静默。
 */
function redirectSchema(sql: string, schema: string): string {
  const rewritten = sql.replaceAll('app.', `${schema}.`);
  const code = rewritten.replace(/--[^\n]*/g, '');
  if (/(?<![\w.])app(?![\w.])/i.test(code)) {
    throw new Error(
      `迁移含不带点的 "app" 引用，无法重定向到 schema ${schema}。` +
        `请改成依赖 search_path，或在调用方显式处理。`,
    );
  }
  return rewritten;
}

async function withClient<T>(
  databaseUrl: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** 建 schema 与版本表。幂等。 */
async function ensureRegistry(client: Client, schema: string): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (
      version     text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
}

/**
 * 应用所有尚未执行的迁移。幂等；并发安全（advisory lock）。
 *
 * 任何一步失败都抛出去，由调用方决定退出码 —— 这里**不吞异常**。
 * 「警告后继续」会让服务带着半套 schema 起来，然后在第一次查询时
 * 报 `column ... does not exist`，看起来像业务代码 bug。
 */
export async function migrateUp(options: MigrateOptions = {}): Promise<MigrateResult> {
  const databaseUrl = options.databaseUrl ?? DEFAULT_DATABASE_URL;
  const migrationsDir = options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const schema = options.schema ?? 'app';
  const log = options.log ?? ((line: string) => console.log(line));
  const rewrite = schema !== 'app';

  return withClient(databaseUrl, async (client) => {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [ADVISORY_LOCK_KEY]);
    try {
      await ensureRegistry(client, schema);

      const appliedRows = await client.query<{ version: string }>(
        `SELECT version FROM ${schema}.schema_migrations`,
      );
      const done = new Set(appliedRows.rows.map((r) => r.version));

      const files = upFiles(migrationsDir);
      const applied: string[] = [];
      let skipped = 0;

      for (const file of files) {
        if (done.has(file)) {
          skipped++;
          continue;
        }
        const raw = readFileSync(join(migrationsDir, file), 'utf8');
        const sql = rewrite ? redirectSchema(raw, schema) : raw;
        const checksum = createHash('sha256').update(raw).digest('hex').slice(0, 16);
        await client.query(sql);
        await client.query(
          `INSERT INTO ${schema}.schema_migrations (version, checksum) VALUES ($1, $2)`,
          [file, checksum],
        );
        applied.push(file);
        log(`  已执行: ${file}`);
      }

      if (applied.length === 0) {
        log(`✓ 数据库已是最新（${files.length} 个迁移全部已应用）`);
      } else {
        log(`✓ 迁移完成：本次执行 ${applied.length} 个，跳过 ${skipped} 个，共 ${files.length} 个`);
      }
      return { applied, skipped, total: files.length };
    } finally {
      // 显式解锁：`client.end()` 也会释放会话锁，但那时如果 end 抛错就没人知道了。
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [ADVISORY_LOCK_KEY]).catch(
        () => undefined,
      );
    }
  });
}

/** 逆序执行配对的下行脚本。缺下行脚本即抛错，绝不静默跳过。 */
export async function migrateDown(options: MigrateOptions = {}): Promise<void> {
  const databaseUrl = options.databaseUrl ?? DEFAULT_DATABASE_URL;
  const migrationsDir = options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const schema = options.schema ?? 'app';
  const log = options.log ?? ((line: string) => console.log(line));
  const rewrite = schema !== 'app';

  await withClient(databaseUrl, async (client) => {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [ADVISORY_LOCK_KEY]);
    try {
      await ensureRegistry(client, schema);
      const appliedRows = await client.query<{ version: string }>(
        `SELECT version FROM ${schema}.schema_migrations`,
      );
      const done = new Set(appliedRows.rows.map((r) => r.version));

      for (const file of upFiles(migrationsDir).reverse()) {
        if (!done.has(file)) continue;
        const downPath = join(migrationsDir, file.replace(/\.sql$/, '.down.sql'));
        if (!existsSync(downPath)) {
          throw new Error(
            `缺少下行脚本 ${file.replace(/\.sql$/, '.down.sql')}。` +
              `回滚必须由人写明怎么退，不做「猜表名然后 DROP」这种事。`,
          );
        }
        const raw = readFileSync(downPath, 'utf8');
        await client.query(rewrite ? redirectSchema(raw, schema) : raw);
        log(`已回滚: ${file}`);
      }
      log('回滚完成（app schema 已清空，版本表随之重建）');
    } finally {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [ADVISORY_LOCK_KEY]).catch(
        () => undefined,
      );
    }
  });
}

/**
 * 导入演示数据。
 *
 * 与迁移分开的原因：seed 是**可重复执行**的演示数据，不该进 schema_migrations
 * （它没有版本概念，也不该参与回滚），更不该让 `db:migrate` 顺手灌进来。
 * 全部语句都是 `ON CONFLICT DO NOTHING`，所以重复跑安全。
 */
export async function runSeed(options: MigrateOptions = {}): Promise<void> {
  const databaseUrl = options.databaseUrl ?? DEFAULT_DATABASE_URL;
  const migrationsDir = options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const schema = options.schema ?? 'app';
  const rewrite = schema !== 'app';

  await withClient(databaseUrl, async (client) => {
    const raw = readFileSync(join(migrationsDir, 'seed.sql'), 'utf8');
    await client.query(rewrite ? redirectSchema(raw, schema) : raw);
    console.log('演示数据已导入（重复执行安全）');
  });
}
