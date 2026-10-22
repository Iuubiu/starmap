/**
 * 语义检索（t82）：Mastra 的 embedder + Mastra 的 VectorStore，**不自研向量层**。
 *
 * ## 为什么 embedder 来自 `@mastra/core/llm` 而不是 `@mastra/rag`
 *
 * 直觉上 embedder 属于 RAG，但 `@mastra/rag@2.7.0` 实际只导出
 * `document` / `rerank` / `graph-rag` / `tools`，**没有任何 embedder**；而且它
 * 当前根本没有装（`require.resolve('@mastra/rag')` → MODULE_NOT_FOUND）。
 * 真正的嵌入模型封装是 `@mastra/core/llm` 里的 `ModelRouterEmbeddingModel`。
 *
 * ## 为什么批量走 `doEmbed` 而不是 `embedV2`
 *
 * `embedV2` / `embedV3` / `embedV1` 都只接受**单值**（`{ model, value }`）。
 * 实测单条 334ms（冷）/ 26ms（缓存命中），而 78,204 个 chunk 走单条要
 * **39 分钟**；`doEmbed({ values })` 批量 32 条 191ms，全库约 13 分钟。
 * 这不是优化，是能不能用的问题。
 *
 * ## 为什么向量库是 libSQL 而不是 pgvector
 *
 * 本机 PostgreSQL 18 的 `pg_available_extensions` 里只有 `cube`（最大 100 维），
 * 装不了 pgvector，而 `bge-m3` 是 **1024 维**。`@mastra/libsql` 的
 * `LibSQLVector` 是 Mastra 官方的、无需扩展的向量实现，落盘就是一个文件。
 *
 * ## 为什么降级要带着「人能读懂的原因」
 *
 * 语义检索是**可选增强**：向量库没建、网关没配、模型名写错，都不该让 API
 * 起不来。但「悄悄关掉」会让排查变成猜谜 —— 所以 `status()` 永远返回一句
 * 具体原因（「向量库文件不存在：…（先跑 pnpm index:embeddings）」），
 * 由 `/health` 原样透出。原因里不许出现 `error`、空串这类没信息量的词。
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 嵌入模型名的回退值。`.env` 里 `EMBEDDING_MODEL=` 是空值时用它。 */
export const DEFAULT_EMBEDDING_MODEL = 'bge-m3';

/** 索引名。`LibSQLVector` 用一个库放多个索引，这里固定一个。 */
export const DEFAULT_INDEX_NAME = 'chunks';

/** 单次 `doEmbed` 的最大条数。实测 32 条 191ms，再大容易撞网关超时。 */
export const EMBED_BATCH_SIZE = 32;

/**
 * 向量库根目录。`STARMAP_EMBEDDINGS_DIR` 优先（测试与特殊部署用）。
 *
 * 路径解析与 `glossary-store.ts` 同法：从模块位置往上找带 `package.json` 的
 * 目录（`src/retrieval` 与 `dist/retrieval` 都能落到 `apps/api`），再往上两级
 * 到仓库根。这样 `tsx` 直跑与编译后跑都能落到同一处。
 */
export function defaultEmbeddingsDir(): string {
  const override = process.env.STARMAP_EMBEDDINGS_DIR;
  if (override && override.trim().length > 0) return resolve(override);

  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i += 1) {
    if (existsSync(join(dir, 'package.json'))) {
      return join(dir, '..', '..', 'content', 'embeddings');
    }
    dir = dirname(dir);
  }
  return fileURLToPath(new URL('../../../content/embeddings', import.meta.url));
}

/** 向量库文件路径（libSQL 的 `file:` URL 去掉前缀）。 */
export function defaultVectorDbPath(dir: string = defaultEmbeddingsDir()): string {
  return join(dir, 'chunks.db');
}

/** 台账文件路径：记录「哪些 chunk 已经按哪个内容哈希嵌入过」。 */
export function defaultLedgerPath(dir: string = defaultEmbeddingsDir()): string {
  return join(dir, 'ledger.json');
}

export interface SemanticStatus {
  /** 语义检索当前是否可用 */
  enabled: boolean;
  /**
   * 不可用时的具体原因（**人话**，直接进 `/health`）。
   * 可用时为 `null`。
   */
  reason: string | null;
}

export interface SemanticHit {
  chunkId: string;
  /** libSQL cosine 相似度，越大越像 */
  score: number;
}

/**
 * 从环境变量造 embedder。
 *
 * `EMBEDDING_MODEL` 为空串时回退 `bge-m3`（本机网关唯一的嵌入模型）。
 * 空值不是「没配」而是「按默认来」—— 网关只有一个模型，写死反而更脆。
 */
export function createEmbedder(env: NodeJS.ProcessEnv = process.env) {
  const url = (env.EMBEDDING_BASE_URL ?? '').trim();
  const apiKey = (env.EMBEDDING_API_KEY ?? '').trim();
  const model = (env.EMBEDDING_MODEL ?? '').trim() || DEFAULT_EMBEDDING_MODEL;
  if (url.length === 0) {
    throw new Error('EMBEDDING_BASE_URL 未配置');
  }
  // 动态 import：`@mastra/core/llm` 会连带加载 provider 注册表，启动路径上
  // 不必为一个可能不用的增强付这份代价（`/health` 每次都要问状态）。
  return import('@mastra/core/llm').then(
    ({ ModelRouterEmbeddingModel }) =>
      new ModelRouterEmbeddingModel({ id: `starmap/${model}`, url, apiKey }),
  );
}

/**
 * 语义检索门面。
 *
 * 构造是**同步且不抛错**的：只做文件存在性检查。真正的模型/向量库连接推迟到
 * 第一次 `query()`，这样 `/health` 不必等一个网络往返。
 */
export class SemanticSearch {
  private readonly dir: string;
  private readonly dbPath: string;
  private store: unknown = null;
  private embedder: Awaited<ReturnType<typeof createEmbedder>> | null = null;
  private failure: string | null = null;
  /**
   * 最近一次 `query()` 的瞬时失败。**不参与 `status()`** —— 一次网关抖动不该
   * 让 `/health` 从此报一个过时的原因。只给日志与测试看。
   */
  lastQueryError: string | null = null;

  constructor(dir: string = defaultEmbeddingsDir()) {
    this.dir = dir;
    this.dbPath = defaultVectorDbPath(dir);
  }

  /**
   * 当前状态。**每次调用都重新看磁盘** —— 索引脚本可以在服务运行期间补建库，
   * 那时 `/health` 应该自己变回 `on`，不该要求重启。
   */
  status(): SemanticStatus {
    if (this.failure !== null) return { enabled: false, reason: this.failure };
    if (!existsSync(this.dir)) {
      return {
        enabled: false,
        reason: `向量库目录不存在：${this.dir}（先跑 pnpm index:embeddings 建索引）`,
      };
    }
    if (!existsSync(this.dbPath)) {
      return {
        enabled: false,
        reason: `向量库文件不存在：${this.dbPath}（先跑 pnpm index:embeddings 建索引）`,
      };
    }
    let size = 0;
    try {
      size = statSync(this.dbPath).size;
    } catch (err) {
      return {
        enabled: false,
        reason: `向量库文件读不到：${this.dbPath}（${(err as Error).message}）`,
      };
    }
    if (size === 0) {
      return { enabled: false, reason: `向量库文件是空的：${this.dbPath}（重建索引）` };
    }
    if ((process.env.EMBEDDING_BASE_URL ?? '').trim().length === 0) {
      return { enabled: false, reason: '嵌入网关未配置：EMBEDDING_BASE_URL 是空值' };
    }
    return { enabled: true, reason: null };
  }

  /** 惰性拿向量库。失败会把原因记进 `failure`，后续 `status()` 如实报出。 */
  private async vectorStore() {
    if (this.store !== null) return this.store as import('@mastra/libsql').LibSQLVector;
    try {
      const { LibSQLVector } = await import('@mastra/libsql');
      const store = new LibSQLVector({
        id: 'starmap-chunks',
        url: `file:${this.dbPath}`,
      });
      const indexes = await store.listIndexes();
      if (!indexes.includes(DEFAULT_INDEX_NAME)) {
        throw new Error(`向量库里没有索引 ${DEFAULT_INDEX_NAME}（已重建索引？）`);
      }
      this.store = store;
      return store;
    } catch (err) {
      this.failure = `向量库加载失败：${(err as Error).message}`;
      throw err;
    }
  }

  private async embeddingModel() {
    if (this.embedder !== null) return this.embedder;
    try {
      this.embedder = await createEmbedder();
      return this.embedder;
    } catch (err) {
      this.failure = `嵌入模型不可用：${(err as Error).message}`;
      throw err;
    }
  }

  /**
   * 用一段自然语言查最近的 chunk。
   *
   * 返回**空数组**而不是抛错：调用方（检索服务）已经有一份 BM25 结果，
   * 语义只是重排依据；它失败时正确的行为是「按原来的排序走」，不是让整次
   * 检索 500。失败原因进 `failure`，由 `/health` 暴露。
   */
  async query(text: string, topK = 50): Promise<SemanticHit[]> {
    if (!this.status().enabled) return [];
    try {
      const [store, model] = await Promise.all([this.vectorStore(), this.embeddingModel()]);
      const embedded = await model.doEmbed({ values: [text] });
      const vector = embedded.embeddings[0];
      if (!vector) return [];
      const results = await store.query({
        indexName: DEFAULT_INDEX_NAME,
        queryVector: vector,
        topK,
      });
      return results.map((r) => ({ chunkId: String(r.id), score: Number(r.score) }));
    } catch (err) {
      // **不写 `failure`**：这里的失败可能是网关一次抖动，粘住会把语义检索
      // 永久关掉，而 `/health` 从此一直报一个已经过时的原因。
      // 「加载不了向量库 / 造不出 embedder」才是粘性的（那是配置或文件问题）。
      this.lastQueryError = `语义检索调用失败：${(err as Error).message}`;
      return [];
    }
  }
}

/**
 * 混合排序：BM25 分与向量分各自归一化后加权。
 *
 * ## 为什么必须归一化
 *
 * MiniSearch 的 BM25 分是**无上界**的（长文档、多命中都能堆到很高），而
 * cosine 相似度在 `[-1, 1]`。直接把两者相加，向量分会被完全淹没 —— 那等于
 * 「没接语义」。所以两边都先除以本批最大值（min-max 到 0..1 的近似），
 * 再按 `VECTOR_WEIGHT` 混合。
 *
 * ## 为什么向量分只重排、不新增候选
 *
 * 候选集来自 BM25，向量只在**同一批候选**上改顺序。这样门控看到的集合与
 * 接语义之前完全一致（「答案块集合」这条不变量不受影响），语义只影响
 * 「先看哪一条」。若要向量也参与召回，得另外处理「BM25 零命中但向量命中」
 * 的情况 —— 那是另一张票的事，本票明确要求「不替换现有检索」。
 */
export const VECTOR_WEIGHT = 0.5;

export function blendScores(
  lexical: number,
  vector: number | null,
  maxLexical: number,
): number {
  const lexicalNorm = maxLexical > 0 ? lexical / maxLexical : 0;
  if (vector === null) return lexicalNorm;
  return (1 - VECTOR_WEIGHT) * lexicalNorm + VECTOR_WEIGHT * Math.max(0, vector);
}
