/**
 * 中文 query → 英文语料的术语桥（t32）。
 *
 * ## 为什么需要它
 *
 * t26 把 15 本英文教材入库后，英文书占全库 60% 的叶知识点，而检索层
 * （`apps/api/src/retrieval/bm25.ts`）是**纯字面匹配**：`tokenize()` 只做 CJK
 * 二元组与 ASCII 词切分，中文 query 与英文正文没有任何共同 token。实测
 * `query=锗探测器能量分辨` 对 `kp-knoll-4e-2010-1` 命中 0 条，同义的
 * `germanium detector resolution` 命中 200 条。学生是全中文界面（D10 红线），
 * 也就是说这 60% 的知识点在检索门控下**等于不存在**。
 *
 * 这不是「检索质量不够好」，是「一半语料不可达」——所以修法不是调 BM25 参数，
 * 而是给查询补上它能匹配到的英文词。
 *
 * ## 词表从哪来（零成本）
 *
 * `tools/ingest/export_glossary.py` 扫 `content/<书>/toc.json`：每个节点都有
 * `name`（中文译名）与 `nameOriginal`（英文原名，D10 要求保留原文），于是
 * t26 的 `translate_nodes()` 顺手留下了 3000+ 条中英对照。产物是
 * `content/glossary.json`，由 `apps/api` 启动时读一次。
 *
 * **engine 不读文件**：这个包是纯函数库（`.dependency-cruiser.cjs` 的
 * engine-is-pure / engine-no-io 规则），词表以参数传入。
 *
 * ## 选词规则：最大化覆盖，而不是「最长匹配优先」
 *
 * 朴素做法是对每条 glossary 条目判断 `query.includes(zh)`，于是
 * `锗探测器能量分辨` 会同时命中 `锗探测器`（对）与 `探测器`（错：它是前者的
 * 子串，展开它会把「Microstrip detectors」「Diamond detectors」这类无关段落
 * 拉进来）。
 *
 * 但「按 zh 长度从长到短扫描、命中就抹掉」这个修法在真实 query 上会出错。
 * 实测 `前置放大器噪声` 的候选是：
 *
 * | 候选 | 覆盖字符 | 展开成 |
 * | --- | --- | --- |
 * | `放大器噪声` | 2–6（5 字） | `Amplifier noise matching` |
 * | `前置放大器` | 0–4（5 字） | `Preamplifier` |
 * | `放大器` | 2–4（3 字） | `Amplifier` |
 * | `噪声` | 5–6（2 字） | `Noise` |
 *
 * 「最长优先」会先吃掉 `放大器噪声`，于是 `前置放大器` 再也匹配不上 ——
 * 而 `放大器噪声` 是一条小节标题（展开成 `Amplifier noise matching`，
 * 在正文里几乎不出现），`前置放大器` + `噪声` 才是学生真正要找的词。
 *
 * 所以规则是**最大化被覆盖的字符数**（区间调度 DP，权重 = 区间长度），
 * 并列时取「词条数更少」的那组（`探测器` 优于 `探测` + `测器`），再并列
 * 按字典序，保证同一输入永远得到同一输出。
 *
 * 这个 DP 的规模可以忽略：query 几十字、候选几十条，每次检索几千次比较。
 *
 * ## 只对中文 query 展开
 *
 * `expandQuery('germanium detector', …)` 必须返回空 `terms`：英文 query 直接
 * 走 BM25 就能命中英文正文，再展开一遍只会让「英文 query 的结果比中英混合
 * query 还少」这种反直觉行为出现，也会让 `extraTerms` 的回归测试失去意义。
 * 判据是「query 里有没有汉字」——没有汉字就没有需要桥接的东西。
 *
 * ## 这个文件不做什么
 *
 * - 不做分词：`zh` 是整条术语（`脉冲成形`），不是词表驱动的分词器；
 * - 不查库、不读文件、不看环境变量：纯函数，输入相同则输出相同；
 * - 不改写 query：`terms` 是**追加**给检索的扩展词，原 query 仍按原样检索。
 *   这一点很重要 —— 中文命中（如果有）不该因为加了英文扩展而掉分。
 */

/** 词表条目。`en` 是同一个中文术语在各地出现的英文写法（可能有多个）。 */
export interface GlossaryEntry {
  /** 中文术语（目录里的译名） */
  readonly zh: string;
  /** 对应的英文原名，一个或多个 */
  readonly en: readonly string[];
}

/** 一条展开记录，供调试器回答「为什么命中了英文」。 */
export interface QueryExpansion {
  /** 命中的中文术语 */
  zh: string;
  /** 由它展开出的英文串 */
  en: string;
}

export interface ExpandedQuery {
  /** 追加给检索的英文扩展词（去重、按出现顺序）。**不含原 query 的 token**。 */
  terms: string[];
  /** 逐条展开记录，`zh` + `en` 一一对应（同一个 zh 有多个 en 时展开成多条） */
  expansions: QueryExpansion[];
}

/** 汉字判定。与 `export_glossary.py` 的 `_CJK` 同一个区间。 */
const CJK = /[\u4e00-\u9fff]/;

/** query 里的一个候选命中区间（左闭右开）。 */
interface Hit {
  zh: string;
  start: number;
  end: number;
}

/**
 * 列出 query 里所有可能的术语命中（**不筛选**，交给 `selectHits` 选）。
 *
 * 每个 (条目, 位置) 组合都是一条候选。同一个条目可能在 query 里出现多次
 * （`探测器的输出与探测器的噪声`），都列出来。
 */
function findHits(query: string, glossary: ReadonlyArray<GlossaryEntry>): Hit[] {
  const hits: Hit[] = [];
  const seen = new Set<string>();
  for (const entry of glossary) {
    const zh = entry.zh;
    if (zh.length < 2) continue;
    // 词表里可能有重复 zh（产物已去重，但入参是外部数据）
    if (seen.has(zh)) continue;
    seen.add(zh);
    let from = 0;
    for (;;) {
      const index = query.indexOf(zh, from);
      if (index === -1) break;
      hits.push({ zh, start: index, end: index + zh.length });
      from = index + 1;
    }
  }
  return hits;
}

/**
 * 从候选里选一组**互不重叠**的命中，使覆盖的字符数最多。
 *
 * 加权区间调度：`best[i]` = 只考虑 query 前 `i` 个字符时的最优解。
 * 对每条结束于 `i` 的区间，`best[start] + (end - start)` 是一个候选。
 *
 * 并列时按（覆盖字符数↓，词条数↑，首个区间位置↑）比较 —— 词条数少优先，
 * 因为 `探测器` 一条比 `探测` + `测器` 两条更贴近「这是一个术语」。
 * 最后按 `start` 排序输出，顺序与读句子一致。
 */
function selectHits(query: string, hits: Hit[]): Hit[] {
  if (hits.length === 0) return [];

  // 按结束位置分桶，便于 DP 扫描
  const byEnd = new Map<number, Hit[]>();
  for (const hit of hits) {
    const bucket = byEnd.get(hit.end);
    if (bucket) bucket.push(hit);
    else byEnd.set(hit.end, [hit]);
  }

  interface Solution {
    coverage: number;
    count: number;
    picks: Hit[];
  }
  const empty: Solution = { coverage: 0, count: 0, picks: [] };
  const best: Solution[] = new Array(query.length + 1);
  best[0] = empty;

  const better = (a: Solution, b: Solution): boolean => {
    if (a.coverage !== b.coverage) return a.coverage > b.coverage;
    if (a.count !== b.count) return a.count < b.count;
    return false; // 完全并列时保留先算出的那个（下面按固定顺序枚举，结果稳定）
  };

  for (let i = 1; i <= query.length; i += 1) {
    let current = best[i - 1]!;
    for (const hit of byEnd.get(i) ?? []) {
      const before = best[hit.start]!;
      const candidate: Solution = {
        coverage: before.coverage + (hit.end - hit.start),
        count: before.count + 1,
        picks: [...before.picks, hit],
      };
      if (better(candidate, current)) current = candidate;
    }
    best[i] = current;
  }

  return [...best[query.length]!.picks].sort((a, b) => a.start - b.start);
}

/**
 * 把中文 query 里出现的术语展开成对应的英文串。
 *
 * @param query 学习者的原始提问（中文、英文或混合）
 * @param glossary 词表（`content/glossary.json` 读出来的数组）
 * @returns `terms` 追加给检索；`expansions` 给调试器解释来源。
 *
 * 纯英文 query 返回空 `terms`/`expansions`（见文件头「只对中文 query 展开」）。
 */
export function expandQuery(
  query: string,
  glossary: ReadonlyArray<GlossaryEntry>,
): ExpandedQuery {
  const result: ExpandedQuery = { terms: [], expansions: [] };
  if (!query || !CJK.test(query) || glossary.length === 0) return result;

  const hits = selectHits(query, findHits(query, glossary));
  if (hits.length === 0) return result;

  const byZh = new Map<string, readonly string[]>();
  for (const entry of glossary) {
    if (!byZh.has(entry.zh)) byZh.set(entry.zh, entry.en);
  }

  const seen = new Set<string>();
  for (const hit of hits) {
    const ens = byZh.get(hit.zh) ?? [];
    for (const en of ens) {
      const term = en.trim();
      if (term.length === 0) continue;
      result.expansions.push({ zh: hit.zh, en: term });
      // 去重按小写比较：`Pulse Shaping` 与 `pulse shaping` 在 BM25 里是同一个
      // token（tokenize 会 toLowerCase），重复加入只会让同一个词被数两次。
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.terms.push(term);
    }
  }

  return result;
}
