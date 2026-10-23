/**
 * 向量索引 DDL 的测试（t82）。
 *
 * 这里测的是**磁盘占用**这件事：`LibSQLVector.createIndex()` 建的是默认参数的
 * DiskANN 索引，实测 213,824 B/行 —— 78,204 个 chunk 投影 16.7 GB。本文件守的是
 * 「我们建的索引一定带压缩参数」，以及「别人用旧脚本建过的库会被自动重建」。
 *
 * 用真 libSQL 文件（临时目录），不 mock：要验的就是 shadow 表的真实行宽，
 * mock 掉之后这条测试就只剩「我调用了一个函数」。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EXPECTED_SHADOW_ROW_BYTES,
  VECTOR_INDEX_OPTIONS,
  createIndexSql,
  ensureCompressedIndex,
  inspectIndexShadow,
  rawVectorBytes,
} from './vector-index-ddl.js';

const DIMENSION = 1024;
const INDEX = 'chunks';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'starmap-vidx-'));
  dbPath = join(dir, 'chunks.db');
});

afterEach(() => {
  // Windows 上 libsql 的本地文件句柄在 `close()` 之后还会被 WAL 线程短暂持有，
  // 立刻 `rmSync` 会 EPERM。重试几次；仍不行就交给系统清理临时目录 ——
  // 临时目录删不掉不该让「磁盘占用」这条断言变成红。
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      const wait = 50 * (attempt + 1);
      const until = Date.now() + wait;
      while (Date.now() < until) {
        /* 忙等：测试里不需要引入异步清理，几十毫秒 */
      }
    }
  }
});

/** 直接往向量表里灌 N 条随机向量，绕开 Mastra（它 upsert 一次一批，慢）。 */
async function seed(rows: number): Promise<void> {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const nested = createRequire(req.resolve('@mastra/libsql'));
  const { createClient } = nested('@libsql/client') as {
    createClient: (config: { url: string }) => {
      execute: (stmt: { sql: string; args?: unknown[] }) => Promise<unknown>;
      close: () => void;
    };
  };
  const client = createClient({ url: `file:${dbPath}` });
  try {
    for (let i = 0; i < rows; i += 1) {
      const vector = `[${Array.from({ length: DIMENSION }, () => Math.random().toFixed(6)).join(',')}]`;
      await client.execute({
        sql: `INSERT INTO "${INDEX}" (vector_id, embedding, metadata) VALUES (?, vector32(?), '{}')`,
        args: [`v${i}`, vector],
      });
    }
  } finally {
    client.close();
  }
}

describe('向量索引 DDL（t82 磁盘占用）', () => {
  it('建索引语句带压缩参数（默认参数会让 78k 行占 16.7 GB）', () => {
    const sql = createIndexSql(INDEX);
    expect(sql).toContain('libsql_vector_idx(embedding');
    expect(sql).toContain('max_neighbors=16');
    expect(sql).toContain('compress_neighbors=float8');
    expect(VECTOR_INDEX_OPTIONS).toBe('max_neighbors=16, compress_neighbors=float8');
  });

  it('裸向量字节数是 dim×4，压缩后的索引行宽是它的约 5 倍（而不是 52 倍）', () => {
    expect(rawVectorBytes(DIMENSION)).toBe(4096);
    const ratio = EXPECTED_SHADOW_ROW_BYTES / rawVectorBytes(DIMENSION);
    // 默认 DiskANN 是 213,824 / 4,096 ≈ 52.2 倍；压缩后 20,880 / 4,096 ≈ 5.1 倍。
    expect(ratio).toBeLessThan(6);
    expect(ratio).toBeGreaterThan(4);
  });

  it('首次调用建表 + 建压缩索引，shadow 行宽落在实测值上', async () => {
    const result = await ensureCompressedIndex({ dbPath, indexName: INDEX, dimension: DIMENSION });
    expect(result.createdTable).toBe(true);
    expect(result.rebuiltIndex).toBe(true);

    await seed(30);
    const shadow = await inspectIndexShadow({ dbPath, indexName: INDEX });
    expect(shadow).not.toBeNull();
    expect(shadow?.rows).toBe(30);
    // 允许 libsql 版本间的少量浮动，但绝不能回到 213,824 那一档。
    expect(shadow?.avgRowBytes).toBeGreaterThan(15_000);
    expect(shadow?.avgRowBytes).toBeLessThan(30_000);
  }, 60_000);

  it('幂等：第二次调用什么都不做', async () => {
    await ensureCompressedIndex({ dbPath, indexName: INDEX, dimension: DIMENSION });
    await seed(5);

    const second = await ensureCompressedIndex({ dbPath, indexName: INDEX, dimension: DIMENSION });
    expect(second.createdTable).toBe(false);
    expect(second.rebuiltIndex).toBe(false);
    expect(second.rebuildMs).toBe(0);
  }, 60_000);

  it('库里已有未压缩的索引（旧脚本建的）时自动重建，而不是原样留着', async () => {
    // 先按 Mastra 的默认方式建：只有 libsql_vector_idx(embedding)，没有压缩参数。
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const nested = createRequire(req.resolve('@mastra/libsql'));
    const { createClient } = nested('@libsql/client') as {
      createClient: (config: { url: string }) => {
        execute: (stmt: { sql: string; args?: unknown[] } | string) => Promise<unknown>;
        close: () => void;
      };
    };
    const client = createClient({ url: `file:${dbPath}` });
    try {
      await client.execute(
        `CREATE TABLE "${INDEX}" (id SERIAL PRIMARY KEY, vector_id TEXT UNIQUE NOT NULL, embedding F32_BLOB(${DIMENSION}), metadata TEXT DEFAULT '{}')`,
      );
      await client.execute(`CREATE INDEX "${INDEX}_vector_idx" ON "${INDEX}" (libsql_vector_idx(embedding))`);
    } finally {
      client.close();
    }
    await seed(10);

    const result = await ensureCompressedIndex({ dbPath, indexName: INDEX, dimension: DIMENSION });
    expect(result.createdTable).toBe(false);
    expect(result.rebuiltIndex).toBe(true);
    expect(result.rows).toBe(10);

    const shadow = await inspectIndexShadow({ dbPath, indexName: INDEX });
    expect(shadow?.avgRowBytes).toBeLessThan(30_000);
  }, 60_000);

  it('没有索引时 inspectIndexShadow 返回 null（不是抛错）', async () => {
    expect(await inspectIndexShadow({ dbPath, indexName: INDEX })).toBeNull();
  });
});
