/**
 * 迁移执行器的集成测试（真连库、真跑 SQL）。
 *
 * 为什么要有这一组：t75 的起因是一次「迁移在仓库里、库里没有」的事故 ——
 * `app.levels` 缺三列，导入接口 500，而 typecheck、单测、`check-migrations`
 * 全绿。`check-migrations` 验的是「迁移文件本身对不对」，验不了
 * 「服务启动时到底有没有把待执行的迁移应用掉」。这里补的就是后者。
 *
 * 全部在临时 schema 上跑：`app_test_<random>`，测完 DROP CASCADE。
 * 不碰开发库的 `app` schema —— 测试绝不能改写真实数据。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { DEFAULT_MIGRATIONS_DIR, migrateUp, upFiles } from './migrate.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap';

const created: string[] = [];
const tempDirs: string[] = [];

function newSchemaName(): string {
  const name = `app_test_${randomBytes(6).toString('hex')}`;
  created.push(name);
  return name;
}

/** 造一个只含指定迁移的临时目录，用来模拟「库比代码旧 / 新」。 */
function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'starmap-mig-'));
  tempDirs.push(dir);
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: DATABASE_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

afterAll(async () => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  if (created.length === 0) return;
  await withClient(async (c) => {
    for (const name of created) await c.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
  });
});

describe('迁移执行器', () => {
  it('库比代码旧时：第二次启动会把新增的迁移应用掉，而不是崩', async () => {
    const schema = newSchemaName();
    const v1 = fixtureDir({
      '0001_first.sql': 'CREATE TABLE IF NOT EXISTS app.t_one (id int PRIMARY KEY);',
      '0001_first.down.sql': 'DROP TABLE IF EXISTS app.t_one;',
    });
    // 第一次「启动」：库里只有 1 个迁移
    const first = await migrateUp({ databaseUrl: DATABASE_URL, migrationsDir: v1, schema, log: () => {} });
    expect(first.applied).toEqual(['0001_first.sql']);

    // 代码前进：仓库里多了一个迁移（库里还没有）
    const v2 = fixtureDir({
      '0001_first.sql': 'CREATE TABLE IF NOT EXISTS app.t_one (id int PRIMARY KEY);',
      '0001_first.down.sql': 'DROP TABLE IF EXISTS app.t_one;',
      '0002_second.sql':
        'ALTER TABLE IF EXISTS app.t_one ADD COLUMN IF NOT EXISTS label text;',
      '0002_second.down.sql': 'ALTER TABLE IF EXISTS app.t_one DROP COLUMN IF EXISTS label;',
    });
    // 第二次「启动」：应当只补跑新增的那个，而不是报错退出
    const second = await migrateUp({ databaseUrl: DATABASE_URL, migrationsDir: v2, schema, log: () => {} });
    expect(second.applied).toEqual(['0002_second.sql']);
    expect(second.skipped).toBe(1);

    // 真的落到了库里，而不只是记了版本号
    await withClient(async (c) => {
      const cols = await c.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = 't_one' ORDER BY column_name`,
        [schema],
      );
      expect(cols.rows.map((r) => r.column_name)).toEqual(['id', 'label']);
    });
  }, 60_000);

  it('幂等：连跑两次，第二次不执行任何迁移也不报错', async () => {
    const schema = newSchemaName();
    const dir = fixtureDir({
      '0001_only.sql': 'CREATE TABLE IF NOT EXISTS app.t_two (id int PRIMARY KEY);',
      '0001_only.down.sql': 'DROP TABLE IF EXISTS app.t_two;',
    });
    const a = await migrateUp({ databaseUrl: DATABASE_URL, migrationsDir: dir, schema, log: () => {} });
    const b = await migrateUp({ databaseUrl: DATABASE_URL, migrationsDir: dir, schema, log: () => {} });
    expect(a.applied).toEqual(['0001_only.sql']);
    expect(b.applied).toEqual([]);
    expect(b.skipped).toBe(1);

    await withClient(async (c) => {
      const rows = await c.query(`SELECT version FROM ${schema}.schema_migrations`);
      expect(rows.rows).toHaveLength(1);
    });
  }, 60_000);

  it('迁移报错时抛出而不是静默继续，且失败的版本不会被记入版本表', async () => {
    const schema = newSchemaName();
    const dir = fixtureDir({
      '0001_ok.sql': 'CREATE TABLE IF NOT EXISTS app.t_three (id int PRIMARY KEY);',
      '0001_ok.down.sql': 'DROP TABLE IF EXISTS app.t_three;',
      // 引用了不存在的表：真实执行一定报错
      '0002_broken.sql': 'ALTER TABLE app.no_such_table ADD COLUMN x int;',
      '0002_broken.down.sql': 'SELECT 1;',
    });
    await expect(
      migrateUp({ databaseUrl: DATABASE_URL, migrationsDir: dir, schema, log: () => {} }),
    ).rejects.toThrow();

    // 关键：失败的那个不能留在版本表里，否则下次启动会「跳过它」并带着坏 schema 起来
    await withClient(async (c) => {
      const rows = await c.query<{ version: string }>(
        `SELECT version FROM ${schema}.schema_migrations ORDER BY version`,
      );
      expect(rows.rows.map((r) => r.version)).toEqual(['0001_ok.sql']);
    });
  }, 60_000);

  it('仓库里全部真实迁移能在空 schema 上跑通（clone 即用的前提）', async () => {
    const schema = newSchemaName();
    const result = await migrateUp({
      databaseUrl: DATABASE_URL,
      migrationsDir: DEFAULT_MIGRATIONS_DIR,
      schema,
      log: () => {},
    });
    const files = upFiles(DEFAULT_MIGRATIONS_DIR);
    expect(result.applied).toEqual(files);
    expect(result.total).toBe(files.length);

    // 抽查几张代码真的依赖的表确实建出来了
    await withClient(async (c) => {
      const t = await c.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = $1 AND table_name IN ('levels', 'chunks', 'knowledge_points')
          ORDER BY table_name`,
        [schema],
      );
      expect(t.rows.map((r) => r.table_name)).toEqual(['chunks', 'knowledge_points', 'levels']);
      const cols = await c.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = 'levels'
            AND column_name IN ('template_id', 'origin', 'share_hash')`,
        [schema],
      );
      expect(cols.rows).toHaveLength(3);
    });
  }, 120_000);

  /**
   * 接线守卫：`dev` / `start` 必须真的串了 `prepare-db.ts`。
   *
   * 这条看起来像在测 `package.json` 的文本，但它守的是一个**类型检查与单测都
   * 覆盖不到**的缺口：自动迁移不是靠代码调用、而是靠 npm script 的 `&&` 串起来的。
   * 谁哪天为了「启动快一点」把那段前缀删掉，上面四条测试照样全绿 ——
   * 因为它们测的是执行器，不是接线。而删掉之后的表现，正是 t75 要修的那个 bug：
   * 服务起得来、接口 500。
   */
  it('dev 与 start 都在起服务前跑了 prepare-db（接线不能被悄悄拆掉）', () => {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      scripts: Record<string, string>;
    };
    for (const name of ['dev', 'start']) {
      const script = pkg.scripts[name] ?? '';
      expect(script, `${name} 脚本不存在`).not.toBe('');
      expect(script, `${name} 没有串 prepare-db`).toContain('prepare-db.ts');
      // 必须是「先迁移，成功后」才起服务：`&&` 而不是 `;` 或 `&`
      expect(script, `${name} 里 prepare-db 与启动之间不是 &&`).toMatch(/prepare-db\.ts\s*&&/);
    }
  });
});
