/**
 * 建语义检索索引（t82）。**可重入**：第二次跑只处理新增/变更的 chunk。
 *
 * ## 为什么需要一份台账文件
 *
 * `LibSQLVector` **不支持 metadata-only 查询**（不给 `queryVector` 会抛
 * `queryVector is required for LibSQL queries`）。也就是说「这个向量库里
 * 已经有哪些 chunk」没法从向量库自己问出来，必须自己记。
 *
 * 台账里记的是 **chunk 内容的 sha256**，不是「已嵌入的 id 列表」：
 * 内容变了（重跑 ingest、修了 OCR）而 id 没变时，只看 id 会跳过它，
 * 于是向量库里的语义与正文脱节 —— 而这种错没有任何报错。
 *
 * ## 为什么要分批 + 断点写台账
 *
 * 全库 78,204 个 chunk，`doEmbed` 批量 32 条约 191ms，整轮十几分钟。
 * 中途 Ctrl-C 或网关 502 时，已经成功的批次必须留在台账里，否则下次要从
 * 头再来 —— 而重来本身又会再花掉十几分钟与等量的网关额度。
 *
 * ## 用法
 *
 * ```bash
 * node --env-file=.env tools/retrieval/index-embeddings.mjs
 * node --env-file=.env tools/retrieval/index-embeddings.mjs --limit 200   # 冒烟
 * node --env-file=.env tools/retrieval/index-embeddings.mjs --rebuild     # 忽略台账
 * ```
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseService } from '../../db/database.service.js';
import {
  DEFAULT_INDEX_NAME,
  EMBED_BATCH_SIZE,
  createEmbedder,
  defaultEmbeddingsDir,
  defaultLedgerPath,
  defaultVectorDbPath,
} from '../semantic-search.js';

/** 嵌入维度。`bge-m3` 是 1024。写死会让换模型时静默错位，所以从首条结果取。 */
const FALLBACK_DIMENSION = 1024;

interface LedgerEntry {
  /** chunk 正文的 sha256 前 16 位 */
  hash: string;
  /** 建索引时用的模型名（换模型后旧向量不可比） */
  model: string;
}

interface Ledger {
  version: 1;
  model: string;
  dimension: number;
  /** chunkId → 嵌入时的内容指纹 */
  chunks: Record<string, LedgerEntry>;
}

function emptyLedger(model: string): Ledger {
  return { version: 1, model, dimension: FALLBACK_DIMENSION, chunks: {} };
}

function readLedger(path: string, model: string): Ledger {
  if (!existsSync(path)) return emptyLedger(model);
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Ledger;
    if (parsed.version !== 1 || typeof parsed.chunks !== 'object' || parsed.chunks === null) {
      throw new Error('台账结构不认识');
    }
    // 换模型后旧向量与新的不可比：整份作废，重新嵌入。
    if (parsed.model !== model) {
      console.log(`  台账里的模型是 ${parsed.model}，当前是 ${model} → 忽略旧台账，全部重嵌`);
      return emptyLedger(model);
    }
    return parsed;
  } catch (err) {
    console.log(`  台账读不了（${(err as Error).message}）→ 当作空台账`);
    return emptyLedger(model);
  }
}

/**
 * 原子写台账：先写 `.tmp` 再 rename。
 *
 * 直接 `writeFileSync` 到目标路径时，进程被杀会留下**半截 JSON** —— 下次
 * 读台账失败会被当成空台账，于是十几分钟的嵌入全部重来。rename 在同一分区上
 * 是原子的，要么是旧的完整台账，要么是新的完整台账。
 */
function writeLedger(path: string, ledger: Ledger): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(ledger), 'utf8');
  renameSync(tmp, path);
}

function fingerprint(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

export interface IndexOptions {
  /** 只处理前 N 条（冒烟用） */
  limit?: number;
  /** 忽略台账，全部重嵌 */
  rebuild?: boolean;
  /** 每批条数，默认 32 */
  batchSize?: number;
  log?: (line: string) => void;
}

export interface IndexResult {
  /** 本轮真正调了网关的条数 */
  embedded: number;
  /** 因为内容没变而跳过的条数 */
  skipped: number;
  /** 库里已经没有、从向量库与台账里清掉的条数 */
  removed: number;
  /** 向量库里的总条数 */
  total: number;
  durationMs: number;
  /** 每次 doEmbed 的耗时（毫秒），用于算单条 p50 */
  batchMs: number[];
  dbPath: string;
}

/**
 * 跑一轮索引。
 *
 * 顺序：读台账 → 读库里的 chunk → 算差集 → 分批嵌入 → 每批成功就落台账 →
 * 最后清掉库里已不存在的向量。
 */
export async function indexEmbeddings(options: IndexOptions = {}): Promise<IndexResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const batchSize = options.batchSize ?? EMBED_BATCH_SIZE;
  const startedAt = Date.now();

  const dir = defaultEmbeddingsDir();
  const dbPath = defaultVectorDbPath(dir);
  const ledgerPath = defaultLedgerPath(dir);
  mkdirSync(dir, { recursive: true });

  const model = (process.env.EMBEDDING_MODEL ?? '').trim() || 'bge-m3';
  const ledger = options.rebuild ? emptyLedger(model) : readLedger(ledgerPath, model);
  log(`向量库：${dbPath}`);
  log(`台账：${ledgerPath}（已记 ${Object.keys(ledger.chunks).length} 条）`);

  const db = new DatabaseService();
  let rows: Array<{ id: string; text: string }>;
  try {
    rows = await db.query<{ id: string; text: string }>('SELECT id, text FROM chunks ORDER BY id');
  } finally {
    await db.onModuleDestroy();
  }
  log(`库里 chunk：${rows.length} 条`);

  const pending: Array<{ id: string; text: string; hash: string }> = [];
  let skipped = 0;
  for (const row of rows) {
    const hash = fingerprint(row.text);
    const known = ledger.chunks[row.id];
    if (!options.rebuild && known && known.hash === hash) {
      skipped += 1;
      continue;
    }
    pending.push({ id: row.id, text: row.text, hash });
  }
  log(`跳过 ${skipped} 条（内容未变）；待嵌入 ${pending.length} 条`);

  const queue = options.limit !== undefined ? pending.slice(0, options.limit) : pending;
  if (queue.length !== pending.length) log(`--limit ${options.limit}：本轮只做前 ${queue.length} 条`);

  const { LibSQLVector } = await import('@mastra/libsql');
  const store = new LibSQLVector({ id: 'starmap-chunks', url: `file:${dbPath}` });
  const model_ = await createEmbedder();

  // 向量库里的总条数：用它判断「要不要新建索引」以及最后的计数。
  const indexes = await store.listIndexes();
  if (!indexes.includes(DEFAULT_INDEX_NAME)) {
    await store.createIndex({
      indexName: DEFAULT_INDEX_NAME,
      dimension: ledger.dimension || FALLBACK_DIMENSION,
      metric: 'cosine',
    });
    log(`新建索引 ${DEFAULT_INDEX_NAME}（dimension=${ledger.dimension || FALLBACK_DIMENSION}，cosine）`);
  }

  let embedded = 0;
  const batchMs: number[] = [];
  for (let i = 0; i < queue.length; i += batchSize) {
    const batch = queue.slice(i, i + batchSize);
    const batchStartedAt = Date.now();
    const embeddedResult = await model_.doEmbed({ values: batch.map((b) => b.text) });
    batchMs.push(Date.now() - batchStartedAt);

    const vectors = embeddedResult.embeddings;
    if (vectors.length !== batch.length) {
      throw new Error(`网关返回的向量条数不对：要 ${batch.length} 条，得 ${vectors.length} 条`);
    }
    const dimension = vectors[0]?.length ?? 0;
    if (dimension === 0) throw new Error('网关返回了空向量');
    if (ledger.dimension !== dimension) {
      // 首次建索引时把真实维度写进台账；之后维度变了说明换了模型，
      // 旧索引的向量不可比 —— 直接报错让人重建，别悄悄混两种维度。
      if (Object.keys(ledger.chunks).length === 0) {
        ledger.dimension = dimension;
        if (!indexes.includes(DEFAULT_INDEX_NAME)) {
          await store.deleteIndex({ indexName: DEFAULT_INDEX_NAME }).catch(() => undefined);
          await store.createIndex({
            indexName: DEFAULT_INDEX_NAME,
            dimension,
            metric: 'cosine',
          });
        }
      } else {
        throw new Error(
          `向量维度与台账不一致：台账 ${ledger.dimension}，网关 ${dimension}（换了嵌入模型？用 --rebuild）`,
        );
      }
    }

    await store.upsert({
      indexName: DEFAULT_INDEX_NAME,
      vectors,
      metadata: batch.map((b) => ({ chunkId: b.id })),
      ids: batch.map((b) => b.id),
    });

    for (const [index, item] of batch.entries()) {
      ledger.chunks[item.id] = { hash: item.hash, model };
      void index;
    }
    embedded += batch.length;
    // 每批落一次台账：中途中断时已成功的批次不重做。
    writeLedger(ledgerPath, ledger);

    const done = Math.min(i + batchSize, queue.length);
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    log(`  已嵌入 ${done}/${queue.length}（${elapsed}s，本批 ${batchMs.at(-1)}ms）`);
  }

  // 清掉库里已经不存在（或内容已变、被重嵌覆盖）的 chunk。
  let removed = 0;
  const liveIds = new Set(rows.map((r) => r.id));
  const stale = Object.keys(ledger.chunks).filter((id) => !liveIds.has(id));
  if (stale.length > 0) {
    for (let i = 0; i < stale.length; i += 500) {
      const slice = stale.slice(i, i + 500);
      await store.deleteVectors({ indexName: DEFAULT_INDEX_NAME, ids: slice });
      for (const id of slice) delete ledger.chunks[id];
      removed += slice.length;
    }
    writeLedger(ledgerPath, ledger);
    log(`清理已不存在的 chunk：${removed} 条`);
  }

  const stats = await store.describeIndex({ indexName: DEFAULT_INDEX_NAME });
  return {
    embedded,
    skipped,
    removed,
    total: stats.count,
    durationMs: Date.now() - startedAt,
    batchMs,
    dbPath,
  };
}

/** 命令行入口。`--limit N` / `--rebuild` / `--batch N`。 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {  const limitIndex = argv.indexOf('--limit');
  const batchIndex = argv.indexOf('--batch');
  const result = await indexEmbeddings({
    limit: limitIndex >= 0 ? Number(argv[limitIndex + 1]) : undefined,
    batchSize: batchIndex >= 0 ? Number(argv[batchIndex + 1]) : undefined,
    rebuild: argv.includes('--rebuild'),
  });

  const sorted = [...result.batchMs].sort((a, b) => a - b);
  const p50 = sorted.length > 0 ? (sorted[Math.floor(sorted.length / 2)] ?? 0) : 0;
  const perItem = result.embedded > 0 ? (result.durationMs / result.embedded).toFixed(0) : '0';
  console.log('');
  console.log(`✓ 索引完成：嵌入 ${result.embedded} 条，跳过 ${result.skipped} 条，清理 ${result.removed} 条`);
  console.log(`  向量库：${result.dbPath}（共 ${result.total} 条向量）`);
  console.log(`  耗时：${(result.durationMs / 1000).toFixed(1)}s（单条约 ${perItem}ms，单批 p50 ${p50}ms）`);
  return 0;
}

/**
 * 只在被**直接执行**时跑。
 *
 * 用 `process.argv[1]` 的尾部匹配而不是 `import.meta.url === pathToFileURL(...)`：
 * 这个文件既会被 `tsx src/retrieval/cli/index-embeddings.ts` 直跑，也会在测试里
 * 被 `import`（那时不该自动开跑，否则一次 `vitest` 就会去调网关）。
 * `tsx` 直跑时 argv[1] 是 `.ts` 源文件路径，编译后是 `.js` —— 两种都认。
 */
const invokedDirectly = /index-embeddings\.(ts|js)$/.test(process.argv[1] ?? '');
if (invokedDirectly) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(`✗ 索引失败：${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof Error && err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
      process.exitCode = 1;
    },
  );
}
