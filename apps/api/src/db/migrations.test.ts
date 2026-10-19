import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * 迁移的**静态**不变量。
 *
 * 这些检查不需要数据库，所以能跟在任何环境下跑。真跑 up/down 的往返
 * 由 `pnpm db:rollback && pnpm db:migrate` 在 CI 里做；这里守住的是
 * 「改了迁移文件却忘了改下行脚本」这类只在回滚时才炸的错误。
 */
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

const upFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql') && !f.startsWith('seed'))
  .sort();

describe('迁移文件', () => {
  it('至少有一个上行迁移', () => {
    expect(upFiles.length).toBeGreaterThan(0);
  });

  it('每个上行迁移都有配对的下行脚本（否则回滚时才发现）', () => {
    const missing = upFiles.filter(
      (f) => !existsSync(join(migrationsDir, f.replace(/\.sql$/, '.down.sql'))),
    );
    expect(missing).toEqual([]);
  });

  it('上行迁移全部幂等（CREATE ... IF NOT EXISTS），重复执行不报错', () => {
    for (const f of upFiles) {
      const sql = readFileSync(join(migrationsDir, f), 'utf8');
      // 允许 CREATE OR REPLACE，但不允许裸 CREATE TABLE/INDEX/SCHEMA
      const bareCreate =
        /CREATE\s+(?!OR\s+REPLACE)(TABLE|INDEX|SCHEMA|UNIQUE\s+INDEX)\s+(?!IF\s+NOT\s+EXISTS)/gi;
      const offenders = sql.match(bareCreate) ?? [];
      expect(offenders, `${f} 里有非幂等的 CREATE`).toEqual([]);
    }
  });

  it('迁移建的业务表都在 app schema，不碰 mastra schema', () => {
    for (const f of upFiles) {
      const sql = readFileSync(join(migrationsDir, f), 'utf8');
      expect(sql, `${f} 不应创建 mastra schema 的表`).not.toMatch(
        /CREATE\s+TABLE[^;]*\bmastra\./i,
      );
    }
  });

  it('seed 不写入 schema_migrations（它不是 schema 演进）', () => {
    const seedPath = join(migrationsDir, 'seed.sql');
    if (!existsSync(seedPath)) return;
    const sql = readFileSync(seedPath, 'utf8');
    expect(sql).not.toMatch(/schema_migrations/i);
  });
});
