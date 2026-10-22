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

/**
 * 迁移文件是否包含 schema 定义（DDL）。
 *
 * 只跑 DDL 的原因见下面 createTestSchema 里的注释：内容迁移（纯 INSERT/DELETE）
 * 会把演示数据塞进测试 schema，让测试自己的 seed 撞主键。
 */
function hasDdl(sql: string): boolean {
  const code = sql.replace(/--[^\n]*/g, '');
  return /\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|UNIQUE\s+INDEX|SCHEMA|TYPE|SEQUENCE|VIEW|FUNCTION|TRIGGER)\b/i.test(
    code,
  );
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
      // **跳过不含任何 DDL 的迁移。**
      //
      // 上面 seed.sql 那条注释说的失败模式，在内容迁移上会原样重现：
      // `0010_levels_teaching_bool.sql` 是纯 INSERT（0 条 DDL），它为了
      // 「新克隆的库能一键 migrate」自己插入了 subjects/modules/knowledge_points。
      // 于是测试 schema 里预先有了 `subjects('nuclear')`，而 nodes/content 两个
      // 控制器的测试又各自 `INSERT INTO subjects (id, name) VALUES ('nuclear', …)`
      // —— 13 个测试全挂在 duplicate key "subjects_pkey" 上。
      //
      // 判据是「这个文件有没有 DDL」而不是白名单文件名：白名单要求每加一个内容
      // 迁移就回来改测试基建（又一处共享写入点），而这条判据问的是本质 ——
      // 测试 schema 需要的是**结构**，演示内容由测试自己种。
      //
      // 只跳过「一条 DDL 都没有」的文件。同时含 DDL 和 INSERT 的迁移会整体执行，
      // 那是可接受的：结构迁移顺手补一行参照数据本来就很常见。
      //
      // 需要这条关卡内容的测试（例如后续的 levels.content.test.ts）必须自己插入，
      // 与「测试要自己种自己需要的最小数据」这条既有约定一致。
      if (!hasDdl(sql)) continue;
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
