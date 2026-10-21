import MiniSearch, { type SearchResult } from 'minisearch';

/**
 * 检索层的 BM25 索引（票 09）。
 *
 * ## 为什么是 BM25 而不是向量检索
 *
 * 两个可用的模型端点都没有 embeddings 接口（实测 `/v1/embeddings` 返回 503/404）。
 * 硬上向量检索要么得本地跑一个 embedding 模型（与「装依赖必须精确版本」的
 * 约束打架，而且 node 里没有可信的中文小模型），要么得把 3546 段文本塞进
 * 提示词让模型自己找（那不是检索，那是烧钱）。BM25 是这条约束下唯一能把
 * 「检索层」做成真实存在的东西。
 *
 * ## 中文分词
 *
 * MiniSearch 的默认分词器按空格与标点切，中文整段会变成一个 token：
 * 「数字集成电路的分类及特点」整个成为一个词，查「集成电路」永远命中不了。
 * 这里用 **CJK 二元组（bigram）**：把连续汉字切成相邻两字的重叠片段。
 *
 * - 单字词（「门」「或」）单独保留；
 * - ASCII 词按 `[a-z0-9][a-z0-9._-]*` 切，「CMOS」「AD9637」「1/f」都能保留；
 * - 不做领域词典：二元组的召回率足够，而维护一份核电子学词典是另一张票的事。
 *
 * 二元组的代价是索引变大（每 N 字产生 N-1 个 token），3546 段文本下这是
 * 十几万 token，可以接受。
 */

export interface IndexedChunk {
  id: string;
  /** 归属微知识点（票 02 的 `chunks.micro_kp_id`），可能为空 */
  microKpId: string | null;
  sourceId: string;
  sourceTitle: string;
  kind: 'text' | 'formula' | 'figure' | 'table';
  page: number | null;
  ordinal: number;
  text: string;
}

/** CJK 二元组分词。导出是为了让测试能直接断言分词结果。 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];

  for (const match of lower.matchAll(/[a-z0-9][a-z0-9._-]*/g)) {
    out.push(match[0]);
  }

  const runs = lower.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of runs) {
    if (run.length === 1) {
      out.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i += 1) {
      out.push(run.slice(i, i + 2));
    }
  }

  return out;
}

export interface ChunkMatch {
  chunk: IndexedChunk;
  score: number;
}

/**
 * 索引。**纯内存、进程内单例**，由 `RetrievalService` 按 schema 缓存。
 *
 * 不做增量更新：语料由入库脚本批量写入（票 02），运行期没有新增 chunk 的
 * 路径。真要做增量，代价是缓存失效逻辑 —— 而缓存失效正是这类系统最容易
 * 出错的地方（搜不到东西、却没人知道为什么）。宁可重建。
 */
export class ChunkIndex {
  private readonly mini: MiniSearch<IndexedChunk>;
  private readonly byId = new Map<string, IndexedChunk>();

  constructor(chunks: readonly IndexedChunk[]) {
    this.mini = new MiniSearch<IndexedChunk>({
      idField: 'id',
      fields: ['text'],
      storeFields: [],
      tokenize,
      // 精确词条匹配即可。开前缀会显著放大召回，让「数字」命中「数字电路」的
      // 同时也命中「数字信号处理」之外的大量无关段——调试器要的是可解释的
      // 命中，不是最大化召回。
      searchOptions: { prefix: false, fuzzy: false, combineWith: 'OR' },
    });
    this.mini.addAll(chunks as IndexedChunk[]);
    for (const chunk of chunks) this.byId.set(chunk.id, chunk);
  }

  get size(): number {
    return this.byId.size;
  }

  get(chunkId: string): IndexedChunk | undefined {
    return this.byId.get(chunkId);
  }

  /**
   * 检索。
   *
   * `limit` 只截断**展示**，不参与门控计算：门控必须看到完整候选集，否则
   * 「三档之间允许的集合差异恰好等于答案块集合」这个不变量就会依赖于
   * 「答案块恰好排在前 limit 名」，而它并不总是如此。
   *
   * ## `extraTerms`：跨语言扩展词（t32）
   *
   * 中文 query 与英文正文没有任何共同 token（`tokenize` 只做 CJK 二元组 +
   * ASCII 词切分），于是英文书那 60% 的叶知识点对中文提问**零命中**。
   * `extraTerms` 是 `expandQuery()` 从术语表里展开出来的英文串。
   *
   * 实现上用 MiniSearch 的查询表达式树：`{combineWith:'OR', queries:[原 query, ...扩展词]}`。
   * 每个子查询各自被 `tokenize` 处理，于是 `Germanium Detectors` 会被切成
   * `germanium` + `detectors` 两个 token —— 这正是要的（正文里不会连写）。
   *
   * ## 为什么扩展词不加权
   *
   * 派单要求「与 query 同等权重」。给原 query 加权听起来更合理（中文命中优先），
   * 但这里有个反直觉的事实：中文 query 对英文正文**本来就零命中**，加权只会在
   * 「中文与英文都能命中」的那少数段落上改变排序，而那种段落两边的相关性差别
   * 没有可靠依据。等权是可解释的：分数 = 所有命中 token 的 BM25 分数之和。
   *
   * ## `extraTerms` 为空时结果必须逐位相同
   *
   * 这是回归约束：中文书（12 本）与纯英文 query 走的都是这条路。空数组时
   * **不进表达式树分支**，直接 `this.mini.search(query)` —— 不依赖 MiniSearch
   * 「单元素 OR 树 == 字符串查询」这种隐式性质。
   */
  search(
    query: string,
    options: { limit?: number; hardCap?: number; extraTerms?: readonly string[] } = {},
  ): ChunkMatch[] {
    const hardCap = options.hardCap ?? 500;
    const extra = (options.extraTerms ?? []).filter((term) => term.trim().length > 0);
    const results = (
      extra.length === 0
        ? this.mini.search(query)
        : this.mini.search({
            combineWith: 'OR',
            queries: [query, ...extra],
          })
    ) as SearchResult[];
    const out: ChunkMatch[] = [];
    for (const result of results.slice(0, hardCap)) {
      const chunk = this.byId.get(String(result.id));
      if (!chunk) continue;
      out.push({ chunk, score: result.score });
    }
    if (options.limit !== undefined) return out.slice(0, options.limit);
    return out;
  }
}

/**
 * 截取可读摘要。命中词附近的上下文比「从头截 120 字」有用得多 ——
 * 检索调试器要回答的是「为什么这一段被命中」。
 *
 * `extraTerms` 是跨语言扩展词（t32）：中文 query `锗探测器能量分辨` 命中的是
 * 英文正文，中文 token 在里面一个都找不到 —— 不把英文词也算进来，摘要会退回
 * 「从头截 160 字」，而命中点可能在 2000 字之后的段落里。
 */
export function buildSnippet(
  text: string,
  query: string,
  width = 160,
  extraTerms: readonly string[] = [],
): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= width) return compact;

  const terms = new Set(
    [...tokenize(query), ...extraTerms.flatMap((term) => tokenize(term))].filter(
      (t) => t.length >= 2,
    ),
  );
  let hitIndex = -1;
  const lower = compact.toLowerCase();
  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index === -1) continue;
    if (hitIndex === -1 || index < hitIndex) hitIndex = index;
  }

  if (hitIndex === -1) return `${compact.slice(0, width)}…`;

  const start = Math.max(0, hitIndex - Math.floor(width / 3));
  const end = Math.min(compact.length, start + width);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < compact.length ? '…' : '';
  return `${prefix}${compact.slice(start, end)}${suffix}`;
}
