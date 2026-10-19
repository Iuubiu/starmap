/**
 * 测试用的临时 schema 管理。
 *
 * 不用「事务包住测试再回滚」——回滚盖不住 DDL、序列、以及连接池里
 * 另一条连接的可见性。每次建一个独立 schema，测完 DROP CASCADE。
 */
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap';

export interface TestSchema {
  name: string;
  drop: () => Promise<void>;
}

export async function createTestSchema(): Promise<TestSchema> {
  const name = `app_test_${randomBytes(6).toString('hex')}`;
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${name}`);
    // 迁移脚本里写的是 app.xxx，用 search_path 让它们落到测试 schema
    await client.query(`SET search_path TO ${name}, public`);
    for (const file of readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      // **绝不执行回滚脚本。** 它们没有 `app.` 前缀可替换（例如
      // `DROP SCHEMA IF EXISTS app CASCADE`），会原样落到真实数据库上。
      // 而且 `.down.sql` 按字母序排在 `.sql` 之前，会先跑回滚再跑建表。
      .filter((f) => !f.includes('.down.'))
      // seed.sql 是演示数据不是 schema 定义。把它当迁移执行会让测试 schema
      // 预先塞满 demo 数据，测试里再插入同样的主键就撞 unique violation。
      // 测试要自己种自己需要的最小数据 —— 否则测试与演示数据耦合。
      .filter((f) => !f.startsWith('seed'))
      .sort()) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8').replaceAll('app.', `${name}.`);
      // 第二道闸：`replaceAll('app.', …)` 只能改写带点的引用。任何不带点的
      // 「app」都意味着这行 SQL 会落到真实数据库的 app schema 上 —— 建表脚本
      // 里出现它是写法问题，直接让测试炸掉而不是静默损坏开发库。
      // 注释先剥掉：注释里写「业务表只在 app schema」不该触发。
      const code = sql.replace(/--[^\n]*/g, '');
      if (/(?<![\w.])app(?![\w.])/i.test(code)) {
        throw new Error(
          `迁移 ${file} 含不带点的 "app" 引用，无法重定向到测试 schema。` +
            `请改成依赖 search_path，或在 test-schema.ts 里显式处理。`,
        );
      }
      await client.query(sql);
    }
  } finally {
    await client.end();
  }

  return {
    name,
    drop: async () => {
      const c = new Client({ connectionString: DATABASE_URL });
      await c.connect();
      try {
        await c.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
      } finally {
        await c.end();
      }
    },
  };
}
