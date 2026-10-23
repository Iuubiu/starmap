/**
 * 向量索引的建表 DDL（t82）—— Mastra 表达不了的那一小段，用原始 SQL 补上。
 *
 * ## 为什么需要这个文件
 *
 * `LibSQLVector.createIndex()` 建的是**默认参数**的 DiskANN 索引：
 *
 * ```sql
 * CREATE INDEX ... ON <表> (libsql_vector_idx(embedding))
 * ```
 *
 * 实测（dim=1024，见 `docs/adr/0009-*.md` 的表）：默认参数下 shadow 表每行
 * **213,824 B**，78,204 个 chunk 投影 **16.7 GB**。这不是「有点大」，是不能用。
 * libsql 官方给索引留了两个参数，压到 **20,880 B/行 → 1.63 GB**：
 *
 * - `max_neighbors=16`：图的出度。默认 32，减半直接把邻居表砍掉一半。
 * - `compress_neighbors=float8`：邻居距离用 8 位压缩存，不再每条邻居存一个 float32。
 *
 * 这两个参数**只能写在 CREATE INDEX 里**，`CreateIndexParams` 没有对应字段，
 * 所以只能用原始 SQL 建。建完之后 Mastra 照常 upsert / query —— 它靠
 * `sqlite_master` 里 `%_vector_idx` 的名字发现索引（`discoverVectorIndexes`），
 * 不关心是谁建的。**「不自研向量层」这条守住了：我们只补一条 DDL，检索仍然全走 Mastra。**
 *
 * ## 为什么必须先建索引再 upsert
 *
 * 反过来（先灌数据再建索引）在 78k 行上要重建一遍全图；而按批 upsert 时索引
 * 是增量维护的，总代价更低，也才能在中断后接着灌。所以 `ensureCompressedIndex`
 * 在**第一次 upsert 之前**调用。
 *
 * ## 为什么参数要能被检测出来
 *
 * 老的 `chunks.db`（默认参数建索引）看起来一切正常，只是占 946 MB。若这里只做
 * 「索引在不在」的判断，它会被原样留下 —— 于是「为什么别人的库 1.6 GB、我的 17 GB」
 * 变成一个没有答案的问题。所以这里读 `sqlite_master` 里的建索引语句，
 * 发现没有 `compress_neighbors` 就**重建**。
 */
import { createRequire } from 'node:module';

/**
 * 索引参数。**改动这里等于改动磁盘占用与召回质量**，改之前先重跑 ADR-0009 里的
 * 那张实测表（不同 dim / max_neighbors / 压缩方式下的 shadow 行宽）。
 */
export const VECTOR_INDEX_OPTIONS = "max_neighbors=16, compress_neighbors=float8";

/** shadow 表每行的期望字节数（dim=1024 + 上面的参数）。只用于日志与断言。 */
export const EXPECTED_SHADOW_ROW_BYTES = 20_880;

/** 单行向量的原始字节数：dim × 4（F32_BLOB）。 */
export function rawVectorBytes(dimension: number): number {
  return dimension * 4;
}

interface LibsqlClient {
  execute(stmt: { sql: string; args?: unknown[] } | string): Promise<{
    rows: Array<Record<string, unknown>>;
  }>;
  close(): void;
}

interface LibsqlClientModule {
  createClient: (config: { url: string }) => LibsqlClient;
}

/**
 * 拿 `@libsql/client`。
 *
 * 它目前是 `@mastra/libsql` 的**传递依赖**（`^0.18.0`），不在 `apps/api/package.json`
 * 里。直接 `import('@libsql/client')` 在 pnpm 的严格 node_modules 下解析不到
 * （实测 MODULE_NOT_FOUND）。这里从 `@mastra/libsql` 的**已解析路径**出发再解析，
 * 拿到的一定是 Mastra 自己用的那一份 —— 版本不会与它错开。
 */
async function libsqlClient(): Promise<LibsqlClientModule> {
  const req = createRequire(import.meta.url);
  const libsqlEntry = req.resolve('@mastra/libsql');
  const nested = createRequire(libsqlEntry);
  return nested('@libsql/client') as LibsqlClientModule;
}

/** 建表语句与 `LibSQLVector.doCreateIndex` 逐字一致（列名、约束、默认值）。 */
function createTableSql(indexName: string, dimension: number): string {
  return `CREATE TABLE IF NOT EXISTS "${indexName}" (
    id SERIAL PRIMARY KEY,
    vector_id TEXT UNIQUE NOT NULL,
    embedding F32_BLOB(${dimension}),
    metadata TEXT DEFAULT '{}'
  )`;
}

/** 带压缩参数的建索引语句。 */
export function createIndexSql(indexName: string): string {
  return `CREATE INDEX IF NOT EXISTS "${indexName}_vector_idx" ON "${indexName}" (libsql_vector_idx(embedding, 'max_neighbors=16', 'compress_neighbors=float8'))`;
}

export interface EnsureIndexResult {
  /** 表是这次新建的 */
  createdTable: boolean;
  /** 索引是这次新建/重建的（表已存在但索引缺失或没压缩，也算） */
  rebuiltIndex: boolean;
  /** 重建索引前的行数（新建表时为 0） */
  rows: number;
  /** 重建索引花掉的毫秒数（没重建时为 0） */
  rebuildMs: number;
}

/**
 * 确保向量表与**带压缩参数的**索引存在。
 *
 * 幂等：表在、索引在且已压缩 → 什么都不做（`rebuildIndex: false`）。
 */
export async function ensureCompressedIndex(options: {
  dbPath: string;
  indexName: string;
  dimension: number;
  log?: (line: string) => void;
}): Promise<EnsureIndexResult> {
  const log = options.log ?? (() => undefined);
  const { createClient } = await libsqlClient();
  const client = createClient({ url: `file:${options.dbPath}` });
  try {
    const tableRow = await client.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
      args: [options.indexName],
    });
    const createdTable = tableRow.rows.length === 0;
    if (createdTable) {
      await client.execute(createTableSql(options.indexName, options.dimension));
      log(`建表 ${options.indexName}（dimension=${options.dimension}）`);
    }

    const indexRow = await client.execute({
      sql: "SELECT sql FROM sqlite_master WHERE type='index' AND name = ?",
      args: [`${options.indexName}_vector_idx`],
    });
    const existingSql = String(indexRow.rows[0]?.sql ?? '');
    const compressed = existingSql.includes('compress_neighbors');

    if (compressed) {
      log(`索引 ${options.indexName}_vector_idx 已存在且已压缩，跳过`);
      return { createdTable, rebuiltIndex: false, rows: 0, rebuildMs: 0 };
    }

    const countRow = await client.execute(`SELECT count(*) AS n FROM "${options.indexName}"`);
    const rows = Number(countRow.rows[0]?.n ?? 0);

    if (existingSql.length > 0) {
      log(
        `索引 ${options.indexName}_vector_idx 存在但未压缩（当前占 ${rows} 行 × 213,824 B）→ 重建为压缩索引`,
      );
      await client.execute(`DROP INDEX "${options.indexName}_vector_idx"`);
    }

    const startedAt = Date.now();
    await client.execute(createIndexSql(options.indexName));
    const rebuildMs = Date.now() - startedAt;
    log(
      `建压缩索引 ${options.indexName}_vector_idx（${VECTOR_INDEX_OPTIONS}）：${rows} 行，${rebuildMs}ms`,
    );

    // **DROP INDEX 不会让文件变小**：旧 shadow 表的页进了 freelist，文件仍是
    // 946 MB。不 VACUUM 的话，日志里「20,880 B/行」与 `ls -l` 看到的 946 MB 会
    // 互相矛盾 —— 而看 `ls` 的人会以为压缩没生效。实测 4,384 行 VACUUM 68s
    // （78k 行约 10 分钟，与重建索引同量级），只在真正重建过索引时才做。
    const vacuumStartedAt = Date.now();
    await client.execute('VACUUM');
    log(`回收磁盘（VACUUM）：${Date.now() - vacuumStartedAt}ms`);

    return { createdTable, rebuiltIndex: true, rows, rebuildMs };
  } finally {
    client.close();
  }
}

/** 诊断用：shadow 表的行数与平均行宽。索引不存在时返回 `null`。 */
export async function inspectIndexShadow(options: {
  dbPath: string;
  indexName: string;
}): Promise<{ rows: number; avgRowBytes: number; dbBytes: number } | null> {
  const { createClient } = await libsqlClient();
  const client = createClient({ url: `file:${options.dbPath}` });
  try {
    const shadow = `${options.indexName}_vector_idx_shadow`;
    const tableRow = await client.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
      args: [shadow],
    });
    if (tableRow.rows.length === 0) return null;
    const stats = await client.execute(
      `SELECT count(*) AS n, coalesce(avg(length(data)), 0) AS avg FROM "${shadow}"`,
    );
    const size = await client.execute(
      'SELECT page_count * page_size AS p FROM pragma_page_count(), pragma_page_size()',
    );
    return {
      rows: Number(stats.rows[0]?.n ?? 0),
      avgRowBytes: Math.round(Number(stats.rows[0]?.avg ?? 0)),
      dbBytes: Number(size.rows[0]?.p ?? 0),
    };
  } finally {
    client.close();
  }
}
