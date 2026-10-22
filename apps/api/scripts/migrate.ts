/**
 * 迁移执行器。手写而不是引 ORM 的迁移工具，因为需求只有三件事：
 * 建 schema、按序执行 SQL 文件、记录已执行版本。
 *
 * 不用事务包住整个迁移：DDL 在 Postgres 里可以进事务，但「可重复执行」
 * 的要求更适合用幂等的 `CREATE SCHEMA IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`
 * 加版本表来判断。重复执行不报错是票 01 的硬验收项。
 *
 * 回滚用**配对的下行脚本** `<name>.down.sql`，不是猜表名。
 * 这里踩过一个坑：早先的实现把文件名当表名去 `DROP TABLE app.0001_init`，
 * 两个错误叠在一起 —— ① 一个迁移建 13 张表而不是 1 张；② `0001_init`
 * 以数字开头，Postgres 里根本不是合法标识符（42601）。回滚必须由人写明
 * 怎么退，猜不出来。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap';

/** 上行脚本（不含 seed，不含 .down.sql） */
function upFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => !f.startsWith('seed'))
    .filter((f) => !f.endsWith('.down.sql'))
    .sort();
}

export async function runMigrations(direction: 'up' | 'down' = 'up'): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS app');
    await client.query(`
      CREATE TABLE IF NOT EXISTS app.schema_migrations (
        version     text PRIMARY KEY,
        checksum    text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set(
      (await client.query<{ version: string }>('SELECT version FROM app.schema_migrations')).rows.map(
        (r) => r.version,
      ),
    );

    const files = upFiles();

    if (direction === 'up') {
      for (const file of files) {
        if (applied.has(file)) {
          console.log(`跳过（已执行）: ${file}`);
          continue;
        }
        const sql = readFileSync(join(migrationsDir, file), 'utf8');
        const checksum = createHash('sha256').update(sql).digest('hex').slice(0, 16);
        await client.query(sql);
        await client.query('INSERT INTO app.schema_migrations (version, checksum) VALUES ($1, $2)', [
          file,
          checksum,
        ]);
        console.log(`已执行: ${file}`);
      }
      return;
    }

    // 回滚：逆序执行配对的下行脚本。缺下行脚本就报错退出，绝不静默跳过 ——
    // 「以为回滚了其实没回滚」比「回滚失败」危险得多。
    for (const file of [...files].reverse()) {
      if (!applied.has(file)) continue;
      const downPath = join(migrationsDir, file.replace(/\.sql$/, '.down.sql'));
      if (!existsSync(downPath)) {
        throw new Error(
          `缺少下行脚本 ${file.replace(/\.sql$/, '.down.sql')}。` +
            `回滚必须由人写明怎么退，不做「猜表名然后 DROP」这种事。`,
        );
      }
      await client.query(readFileSync(downPath, 'utf8'));
      console.log(`已回滚: ${file}`);
    }
    console.log('回滚完成（app schema 已清空，版本表随之重建）');
  } finally {
    await client.end();
  }
}

/**
 * 导入演示数据。
 *
 * 与迁移分开的原因：seed 是**可重复执行**的演示数据，不该进 schema_migrations
 * （它没有版本概念，也不该参与回滚），更不该让 `db:migrate` 顺手灌进来。
 * 全部语句都是 `ON CONFLICT DO NOTHING`，所以重复跑安全。
 */
export async function runSeed(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const sql = readFileSync(join(migrationsDir, 'seed.sql'), 'utf8');
    await client.query(sql);
    console.log('演示数据已导入（重复执行安全）');
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1]?.replace(/\\/g, '/').includes('migrate');
if (isMain) {
  const arg = process.argv[2];
  const task =
    arg === 'down' ? runMigrations('down') : arg === 'seed' ? runSeed() : runMigrations('up');
  task
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error('执行失败:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
