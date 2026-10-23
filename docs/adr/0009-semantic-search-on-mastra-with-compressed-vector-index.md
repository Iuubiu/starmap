# 语义检索用 Mastra 的 store，但向量索引的 DDL 由我们自己补一条

t82 要给检索加语义重排。票面要求「复用 Mastra 的 embedder 与 VectorStore，禁止自研」—— 这一条是对的，重写一套向量存储与 ANN 检索是这个项目负担不起的。但把它执行到底会撞上一个票面没预料到的事实：**Mastra 提供的建索引入口，建出来的索引在这台机器上占 16.7 GB。**

## Considerations

### 为什么 embedder 不在 `@mastra/rag` 里

直觉上 embedder 属于 RAG，但 `@mastra/rag@2.7.0` 只导出 `document` / `rerank` / `graph-rag` / `tools`，**没有任何 embedder**，而且它当前根本没装。真正的嵌入模型封装是 `@mastra/core/llm` 的 `ModelRouterEmbeddingModel`：

```ts
new ModelRouterEmbeddingModel({ id: `starmap/${model}`, url: EMBEDDING_BASE_URL, apiKey: EMBEDDING_API_KEY })
```

这仍然是 Mastra 的实现，只是不在票面猜的那个包里。网关只有一个模型 `bge-m3`（1024 维），`.env` 的 `EMBEDDING_MODEL` 是空值时回退到它。

### 为什么批量必须走 `doEmbed`

`embedV2` / `embedV3` / `embedV1` 都只接受**单值**（`{ model, value }`）。实测单条 334 ms（冷）/ 26 ms（缓存命中），78,204 个 chunk 走单条要 **39 分钟**；`doEmbed({ values })` 批量 32 条约 191 ms，全库十几分钟。这不是优化，是能不能用的问题。

### 为什么是 libSQL 而不是 pgvector

本机 PostgreSQL 18 的 `pg_available_extensions` 里只有 `cube`（最大 100 维），装不了 pgvector，而 `bge-m3` 是 1024 维。`@mastra/libsql` 的 `LibSQLVector` 是 Mastra 官方的、无需扩展的向量实现，落盘就是一个文件。

### 16.7 GB 是怎么来的（决定性的一张表）

`LibSQLVector.createIndex()` 建的是**默认参数**的 DiskANN 索引：

```sql
CREATE INDEX ... ON <表> (libsql_vector_idx(embedding))
```

libSQL 的 DiskANN 索引会建一张 shadow 表，每行存「完整向量 + 邻居表」。实测（dim=1024）：

| 索引参数 | shadow 行宽 | 78,204 行投影 |
|---|---|---|
| 默认（Mastra 的 `createIndex`） | 213,824 B | **16.7 GB** |
| `max_neighbors=16` | 69,904 B | 5.47 GB |
| `compress_neighbors=float8` | 107,864 B | 8.44 GB |
| **`max_neighbors=16, compress_neighbors=float8`** | **20,880 B** | **1.63 GB** |

行宽与维度成比例（dim=4 时 320 B、dim=128 时 19,536 B），所以这不是数据量的问题，是索引结构的问题。

另一条路是**不建索引**（`LibSQLVector` 在发现不到 `%_vector_idx` 时自动降级为暴力扫描）：78,204 × 1024 全表扫，`query({ topK: 50 })` 实测 **p50 1721 ms**。每个对话回合多 1.7 秒，不可接受。

### 为什么「只补一条 DDL」不算自研

压缩参数只能写在 `CREATE INDEX` 里，`CreateIndexParams` 没有对应字段。所以 `apps/api/src/retrieval/vector-index-ddl.ts` 先用原始 SQL 建表 + 建压缩索引，再让 `LibSQLVector` 照常 `upsert` / `query`。

关键事实：`LibSQLVector` **靠 `sqlite_master` 里 `%_vector_idx` 的名字发现索引**（`discoverVectorIndexes`），不关心是谁建的。建完之后它自己的 `queryWithIndex()` 走 `vector_top_k`，我们一行检索代码都没写。**「不自研向量层」守住了：我们补的是一条 DDL，检索仍然全走 Mastra。**

在真实 4,320 行的 `chunks.db` 上验证过：用压缩索引重建后，同一查询的 **top-3 与未压缩索引完全一致**，第 4–5 名有近似邻居差异（DiskANN 本身就是近似索引，压缩只影响远处的名次）。

### 顺带发现：`DROP INDEX` 不让文件变小

重建索引后文件仍是 946 MB —— 旧 shadow 表的页进了 freelist。不 VACUUM 的话，日志里「20,880 B/行」与 `ls -l` 的 946 MB 会互相矛盾，而看 `ls` 的人会以为压缩没生效。所以 `ensureCompressedIndex` 在**真正重建过索引时**才 `VACUUM`（实测 4,384 行 68 s，78k 行约 10 分钟，与重建索引同量级）。

## Consequences

- **索引必须先于 `LibSQLVector` 构造**：它的构造函数就把索引名单读进 `vectorIndexes`，后建索引会让本次进程一直走暴力扫描。`index-embeddings.ts` 里 `ensureCompressedIndex` 排在 `new LibSQLVector(...)` 之前，这条顺序有注释守着。
- `ensureCompressedIndex` 会**检测**索引的建索引语句：发现没有 `compress_neighbors` 就重建。老库（默认参数建的）不会「看起来正常但占 946 MB」地留下来。
- 台账（`content/embeddings/ledger.json`）记的是 **chunk 正文的 sha256**，不是「已嵌入的 id 列表」。内容变了而 id 没变时（重跑 ingest、修了 OCR），只看 id 会跳过它，于是向量库里的语义与正文脱节 —— 而这种错没有任何报错。`LibSQLVector` 不支持 metadata-only 查询（不给 `queryVector` 会抛错），所以「已经有哪些 chunk」只能自己记。
- 语义检索是**可选增强**：向量库没建、网关没配、模型名写错，都不该让 API 起不来。降级时 `/health` 的 `semanticSearch: 'off'` 必须带一句**人能读懂的具体原因**（「向量库文件不存在：…（先跑 pnpm index:embeddings 建索引）」），不许写 `error` 或空串 —— 悄悄关掉会让排查变成猜谜。
- 向量只**重排** BM25 候选，不新增候选：门控看到的集合与接语义之前完全一致（「答案块集合」这条不变量不受影响），语义只影响「先看哪一条」。要让向量也参与召回得另外处理「BM25 零命中但向量命中」，那是另一张票的事。
- 混合排序必须先归一化：MiniSearch 的 BM25 分无上界，cosine 在 `[-1, 1]`，直接相加会让向量分被完全淹没 —— 那等于「没接语义」。
- `@libsql/client` 是 `@mastra/libsql` 的传递依赖，不在 `apps/api/package.json` 里，pnpm 严格 node_modules 下 `import('@libsql/client')` 解析不到。`vector-index-ddl.ts` 从 `@mastra/libsql` 的**已解析路径**出发再解析，拿到的一定是 Mastra 自己用的那一份，版本不会错开。
