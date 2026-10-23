# t82 语义检索：接 Mastra 的 embedder + libSQL 向量库

> 本文件是 t82 的交付记录（团队任务号，不对应 `.scratch/starmap-core/issues/`
> 里的 20 张票编号）。票面五条验收逐条对应见文末「验收」。

## 一、选型：`LibSQLVector` 而不是 Qdrant / pgvector

| 方案 | 结论 |
|---|---|
| pgvector | **装不上**。本机 `pg_available_extensions` 只有 `cube`，上限 100 维，而 `bge-m3` 是 1024 维；Windows + PG18 也没有现成 binary |
| Qdrant | **不用**。需要 Docker，容器链路在本机反复不可用；多一个必须常驻的外部服务 |
| **libSQL（`@mastra/libsql`）** | **选它**。嵌入式文件库 `content/embeddings/chunks.db`，零外部依赖，`pnpm index:embeddings` 建完就完事 |

> 任务书里曾出现过「改用 Qdrant」的口头指示，最终落地是 libSQL。captain 已明确接受这个偏离，
> 理由是 pgvector 装不上、Docker 链路不可用，而 libSQL 是嵌入式、无需外部服务、能当天跑通。
> **没有 Qdrant 在跑是正确状态，不是缺陷**——`curl 127.0.0.1:6333` 返回 `000` 是预期的。

`@mastra/libsql` 是 Mastra 官方的 `MastraVector` 实现，`upsert` / `query` / `deleteVectors` 全走它，
**没有自研向量层**。

## 二、`chunks.db` 最终体积 1916.9 MB 花在哪

| 组成 | 体积 | 说明 |
|---|---|---|
| 向量本体 | **302 MB** | 78,204 × 1024 维 × 4 B（float32） |
| DiskANN 索引 shadow 表 | **1.54 GB** | 78,204 行 × 20,880 B/行 |
| SQLite 页开销 + WAL | 余下约 75 MB | `freelist` 实测 1 页，无碎片浪费 |

索引已是 libSQL 当前能给的最紧参数：

```sql
CREATE INDEX "chunks_vector_idx" ON "chunks"
  (libsql_vector_idx(embedding, 'max_neighbors=16', 'compress_neighbors=float8'))
```

| 索引参数 | shadow 行宽 | 78,204 行投影 |
|---|---|---|
| 默认（Mastra 的 `createIndex`） | 213,824 B | **16.7 GB** |
| `max_neighbors=16` | 69,904 B | 5.47 GB |
| `compress_neighbors=float8` | 107,864 B | 8.44 GB |
| **`max_neighbors=16` + `compress_neighbors=float8`** | **20,880 B** | **1.63 GB** |

**再压就得自研向量层**（`LibSQLVector` 只吃 `number[][]`，float16 量化需要绕开它的
`upsert`/`query`），违反票面硬约束，到此为止。

`.gitignore` 第 71 行 `content/embeddings/` 挡住，不入库。这是**本机磁盘**，不是产品体积、
不是用户下载量。

## 三、查询延迟：付了 1.5 GB 换来了什么

30 次同分布查询（10 条核电子学问题循环 3 遍，`topK: 50`），跑在 78,204 条向量的真实库上：

| 阶段 | p50 | p95 | 均值 |
|---|---|---|---|
| 嵌入（`doEmbed`，网关往返） | **23 ms** | 67 ms | 38 ms |
| 向量检索（`store.query`） | **35 ms** | 206 ms | 72 ms |
| 合计 | **59 ms** | 259 ms | 110 ms |

每次稳定返回 **50 条**（`hitsAvg: 50`）。

对照：**不建索引**时 `LibSQLVector` 自动降级为暴力扫描，78,204 × 1024 全表扫 `topK: 50`
实测 **p50 1721 ms**。所以这 1.5 GB 换来的是 **35 ms vs 1721 ms，约 49 倍**。
（若不建索引，`.db` 只剩 302 MB —— 省 1.5 GB，每回合多 1.7 秒。captain 裁定选前者。）

HTTP 侧实测（`GET /api/v1/agent/retrieval/debug`，含 BM25 + 门控 + 重排全链路）：
冷启动首请求 **19.9 s**（`LibSQLVector` 构造要读索引元数据 + 首次加载），
热请求 **175 ms / 459 ms / 175 ms**。

## 四、混合排序：只重排，不新增候选

候选集仍由 BM25 产生，向量只在**同一批候选**上改顺序：

```ts
// apps/api/src/retrieval/semantic-search.ts
export const VECTOR_WEIGHT = 0.5;

export function blendScores(lexical: number, vector: number | null, maxLexical: number): number {
  const lexicalNorm = maxLexical > 0 ? lexical / maxLexical : 0;
  if (vector === null) return lexicalNorm;
  return (1 - VECTOR_WEIGHT) * lexicalNorm + VECTOR_WEIGHT * Math.max(0, vector);
}
```

两条理由：

1. **门控看到的集合不变**。「答案块集合」这条不变量（票 09）不受语义影响，语义只影响「先看哪一条」。
2. **必须先归一化**。MiniSearch 的 BM25 分无上界，cosine 在 `[-1, 1]`，直接相加会让向量分被完全淹没 —— 那等于「没接语义」。

实测同一 query「为什么卡诺图能化简」/ `microKpId=kp-bool`：

- 语义 **on**：`semantic: {enabled: true, reason: null, reranked: 124}`，top5 全部是 `digital-kanghua-5e`
  与 `digital-electronics-yanshi-6e`（中文教材），页码 43/44/51/65/262
- 语义 **off**：`semantic: {enabled: false, reason: "向量库目录不存在：…（先跑 pnpm index:embeddings 建索引）", reranked: 0}`，
  top5 与 on 的**重叠 0/5**
- 两边的 `gateTier`（`full`）、`current`（0.9282）、`answerChunkCount`（0）、`totalMatched`（200）**完全一致** ——
  证明「语义只改顺序，不改集合」这条不变量成立

## 五、索引脚本可重入

台账 `content/embeddings/ledger.json` 记的是 **chunk 正文的 sha256**，不是「已嵌入的 id 列表」：

```json
{"version":1,"model":"bge-m3","dimension":1024,
 "chunks":{"ck-analog-...":{"hash":"e285e5c6ea7f224f","model":"bge-m3"}, ...}}
```

**为什么是内容哈希而不是 id**：内容变了而 id 没变时（重跑 ingest、修了 OCR），只看 id 会跳过它，
于是向量库里的语义与正文脱节 —— 而这种错没有任何报错。
`LibSQLVector` 不支持 metadata-only 查询（不给 `queryVector` 会抛
`Metadata-only queries are not supported by this vector store`），所以「已经有哪些 chunk」只能自己记。

第二次跑（实测）：

```
台账：content/embeddings/ledger.json（已记 78204 条）
库里 chunk：78204 条
跳过 78204 条（内容未变）；待嵌入 0 条
索引 chunks_vector_idx 已存在且已压缩，跳过
✓ 索引完成：嵌入 0 条，跳过 78204 条，清理 0 条
  耗时：3.4s（单条约 0ms，单批 p50 0ms）
```

台账**原子写**（先写 `.tmp` 再 `rename`），每批落一次盘：中途 Ctrl-C 或网关 502 时已成功的批次不重做。

## 六、降级：悄悄关掉比报错更糟

`SemanticSearch.status()` 返回 `{ enabled, reason }`，`/health` 直接透传：

```json
{"status":"ok","dbNow":"...","version":"0.1.0",
 "semanticSearch":"off",
 "semanticSearchReason":"向量库目录不存在：D:\\DeepSeek\\starmap\\.scratch\\t82\\no-such-dir（先跑 pnpm index:embeddings 建索引）"}
```

`reason` 必须是**人能读懂的具体原因**（`语义检索` 契约里是 `string | null`，非可选）。
写 `error` 或空串会让排查变成猜谜 —— 降级的全部意义就是让失效可观察。

## 七、实现位置

| 文件 | 作用 |
|---|---|
| `apps/api/src/retrieval/semantic-search.ts` | `createEmbedder` / `SemanticSearch`（懒加载、降级、`status()`）/ `blendScores` |
| `apps/api/src/retrieval/vector-index-ddl.ts` | 压缩索引 DDL + 检测旧索引自动重建 + VACUUM 回收 |
| `apps/api/src/retrieval/cli/index-embeddings.ts` | 索引 CLI（`--rebuild` / `--limit` / `--batch`） |
| `apps/api/src/retrieval/retrieval.service.ts` | 混合重排（`:386-400` 语义分支、`:455` 回传 `semantic`） |
| `apps/api/src/retrieval/retrieval.controller.ts` | `/agent/retrieval/debug` 透传 `semantic` 与 hit 的 `sourceId` |
| `docs/adr/0009-semantic-search-on-mastra-with-compressed-vector-index.md` | 完整决策记录 |

## 八、验收

| # | 票面要求 | 实测 |
|---|---|---|
| ① | 真查询「为什么卡诺图能化简」→ 5 条，带 `sourceId` + 页码，至少 1 条中文教材 | **5 条，全部带 `sourceId` + `page`，5/5 来自中文教材**（`digital-kanghua-5e` ×4、`digital-electronics-yanshi-6e` ×1，页码 65/43/262/51/44） |
| ② | 关掉向量库重跑 → 仍返回 5 条，`/health` 显示 off + 原因 | **5 条**（纯 SQL 回落，`totalMatched: 200`），`/health` → `semanticSearch: "off"` + `"向量库目录不存在：…（先跑 pnpm index:embeddings 建索引）"` |
| ③ | 索引脚本可重入，第二次只处理新增/变更，打印「跳过 N 条」 | **`跳过 78204 条（内容未变）；待嵌入 0 条`，耗时 3.4s** |
| ④ | 台账：嵌入条数、耗时、磁盘占用、单次查询 p50 | **78,204 条 / 2900 s（单条约 39 ms，单批 p50 334 ms）/ 1916.9 MB / 查询 p50 35 ms（合计 59 ms）** |
| ⑤ | `pnpm verify` 七段全绿 | **`✓ 全部 7 段通过，可以合并`，exit 0，195 s**（e2e smoke 13 passed） |

## 九、已知边界

- **冷启动首请求 19.9 s**：`LibSQLVector` 构造时读索引元数据。对 dev 可接受，
  若将来做常驻服务应改成启动时预热。
- **语义不参与召回**：BM25 零命中时向量不会补位。要让向量也参与召回得处理
  「BM25 零命中但向量命中」，那是另一张票的事（票面明确要求「不替换现有检索」）。
- **`@libsql/client` 是传递依赖**：`vector-index-ddl.ts` 从 `@mastra/libsql` 的已解析路径
  再解析，拿到的一定是 Mastra 自己用的那份，版本不会错开。
- **索引必须先于 `LibSQLVector` 构造**：它的构造函数就把索引名单读进 `vectorIndexes`，
  后建索引会让本次进程一直走暴力扫描。`index-embeddings.ts` 里 `ensureCompressedIndex`
  排在 `new LibSQLVector(...)` 之前，这条顺序有注释守着。
- **规模上限**：千万切片级时应换成独立向量服务（见 `NEXT-VERSION.md` 第 13 节）。
