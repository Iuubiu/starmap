import { Inject, Injectable, Logger } from '@nestjs/common';
import { type EventEmitter } from 'node:events';
import { DatabaseService } from '../db/database.service.js';

/**
 * 语料变更信号。
 *
 * 索引是进程内缓存，而「缓存什么时候失效」是这类系统最容易静默出错的地方：
 * 入库脚本刚跑完，检索却还在用旧索引，表现为「新内容搜不到、旧内容还在」，
 * 且没有任何报错。所以不猜、也不按时间过期 —— 由写入方显式 `emit`。
 *
 * 测试里换 schema 也算一次语料变更（`DatabaseService.useSchema` 之后索引的
 * 缓存键会变，但事件总线让「同一个 schema 内重新种数据」也有确定的失效路径）。
 */
export const CORPUS_CHANGED = Symbol('CORPUS_CHANGED');

/**
 * 检索门控档位。与 `@starmap/engine` 的 `GateTier` 是同一个概念，
 * 这里重新声明是为了让 controller 不必依赖 engine 的 type 导出位置。
 */
export type GateTier = 'background' | 'scaffold' | 'full';

/** 一次检索的候选（门控前）。 */
export interface CandidateChunk {
  id: string;
  microKpId: string | null;
  sourceId: string;
  sourceTitle: string;
  kind: 'text' | 'formula' | 'figure' | 'table';
  page: number | null;
  ordinal: number;
  text: string;
  score: number;
}

/** 门控后的结论。`exclusionReason` 只在 `allowed === false` 时有值。 */
export interface GatedChunk extends CandidateChunk {
  isAnswerChunk: boolean;
  allowed: boolean;
  tier: GateTier;
  exclusionReason: string | null;
}

export interface RetrievalOutcome {
  tier: GateTier;
  current: number | null;
  /** 门控前的完整候选集（票 09 的「调试器要看到命中」） */
  candidates: CandidateChunk[];
  gated: GatedChunk[];
  allowed: GatedChunk[];
  excluded: GatedChunk[];
  answerChunkIds: string[];
  /**
   * 跨语言扩展记录（t32）。中文 query 命中的术语 → 展开出的英文串。
   * 调试器用它回答「为什么一条中文提问命中了英文正文」。
   */
  expansions: QueryExpansion[];
  /** 实际参与检索的扩展词（去重后）。摘要取词也用它。 */
  extraTerms: string[];
  /**
   * 语义重排的状态（t82）。
   *
   * 为什么要把「关掉了」这件事放进返回值而不是只写日志：调试器要能回答
   * 「为什么这条排在前面」—— 如果语义悄悄失效、排序退回纯 BM25，看到的
   * 名次差异就无从解释。`reason` 与 `/health` 的 `semanticSearchReason`
   * 是同一个字符串。
   */
  semantic: {
    enabled: boolean;
    reason: string | null;
    /** 参与重排的候选条数（向量库返回的交集大小） */
    reranked: number;
  };
}

/**
 * 门控阈值。**必须与 `packages/engine/src/retrieval-gate.ts` 的
 * `GATE_THRESHOLDS` 一致** —— 那边是权威定义，这里是转述。
 *
 * 为什么这里还要写一份：engine 的 `filterChunks` 只做「答案块放不放行」，
 * 而 background 档还要额外排除公式与表格（见 `applyTierShape`）。阈值本身
 * 两边必须同源，所以干脆 import 过来，不自己写数字。
 */
import { GATE_THRESHOLDS, gateTierFor, filterChunks, expandQuery } from '@starmap/engine';
import type { GlossaryEntry, QueryExpansion } from '@starmap/engine';
import { ChunkIndex, buildSnippet, type IndexedChunk } from './bm25.js';
import { loadGlossary, type LoadedGlossary } from './glossary-store.js';
import { SemanticSearch, blendScores } from './semantic-search.js';

export { GATE_THRESHOLDS, gateTierFor };

/**
 * 按档位收紧「允许的内容形态」。
 *
 * spec §6 的三档不只是「答案放不放行」，还规定了每档的教学用途：
 *
 * | 档位 | 用途 | 允许的块 |
 * | --- | --- | --- |
 * | `background` | 只有背景 | 叙述性文本与图（不含公式与表格） |
 * | `scaffold` | 提示／结构／定义 | 除答案块以外全部 |
 * | `full` | 全部 | 全部 |
 *
 * 公式与表格是**结构**内容（「该用哪个关系式」「参数表」），属于脚手架档；
 * 背景档只给叙述与图示。这条区分让三档的允许集合两两不同，也让
 * 「scaffold 与 full 的差集恰好等于答案块集合」这个不变量成立
 * （若背景档也排除答案块以外的公式，那个差集就不止答案块了）。
 */
function applyTierShape<
  T extends { id: string; kind: 'text' | 'formula' | 'figure' | 'table' },
>(
  chunks: readonly T[],
  tier: GateTier,
): { allowed: T[]; excluded: Array<{ id: string; reason: string }> } {
  if (tier !== 'background') return { allowed: [...chunks], excluded: [] };

  const allowed: T[] = [];
  const excluded: Array<{ id: string; reason: string }> = [];
  for (const chunk of chunks) {
    if (chunk.kind === 'formula' || chunk.kind === 'table') {
      excluded.push({
        id: chunk.id,
        reason:
          chunk.kind === 'formula'
            ? '公式属于脚手架档的结构内容，背景档只提供叙述性文本与图示'
            : '表格属于脚手架档的结构内容，背景档只提供叙述性文本与图示',
      });
    } else {
      allowed.push(chunk);
    }
  }
  return { allowed, excluded };
}

/**
 * 「答案附录」节点的判据 —— SQL 片段，**唯一一处**。
 *
 * ## 为什么需要它：`chunk_kp_answer` 漏掉了整本书的答案附录
 *
 * 答案块门控原来只查 `chunk_kp_answer`，这个查询隐含假设「答案块总是属于某个
 * **叶**知识点」。真实语料不成立：4 个「部分习题答案」节点是**非叶容器**
 * （`is_leaf = false`），名下共 514 个 chunk、255 对 `chunk_kp_answer` 标注 ——
 * 而那些标注是**空转的**，因为 `answerChunkIdsFor` 永远以叶节点 id 调用，
 * 永远查不到容器节点自己的标注。全库 10287 对答案标注里 1593 对挂在非叶节点上。
 *
 * 后果实测过：100 个真实叶知识点 × 3 种提问模板 = 300 次检查，**background 档**
 * （最保守的那一档）仍有 29 次（9.7%）放行了答案附录里的 chunk。更坏的一例是
 * 一道题的完整解答正文 kind 是 `formula` ——它在 background 档被第二道门
 * （档位形态）挡住，看起来没事；但 scaffold 档放行 formula，答案就漏了。
 * 「恰好被另一道门挡住」不能当门控。
 *
 * ## 为什么判据必须是一个函数
 *
 * 这个条件会在 SQL 里被引用，也可能被别的查询引用（例如内容健康检查）。
 * 复制第二份就一定会漂移，而漂移的表现是「某些书漏答案」——不会报错。
 * 所以只留这一个出口。
 *
 * ## 判据：只读 `kp.is_answer_key` 一列
 *
 * 迁移 0006 加了 `kp.is_answer_key`（`NOT NULL DEFAULT false`），由
 * `tools/ingest/toc.py::is_answer_key_title()` 派生、`import-content.ts` 写入。
 * 它是**唯一真源**：判据是「附件 + 标题以答案/解答收尾」，两步缺一不可，宽一寸
 * 就会把「答案要点」这类正文节点误判成整本答案。`tools/ingest/test_content_artifacts.py`
 * 有一条不变量测试守着产物与这条规则一致，所以这里不需要第二个来源。
 *
 * ## 曾经有过一条正则兜底，为什么删掉了
 *
 * 0006 只加列、导入还没重跑的那段时间里，全库 `is_answer_key` 全是 false，
 * 只读列会让 4 个答案附录被判成「不是答案附录」，门控直接退回修复前（实测
 * 300 次探针 29 次泄漏）。当时用 OR 兜底：
 *
 *   `kp.is_answer_key OR (NOT kp.is_leaf AND kp.name ~ '答案|解答')`
 *
 * 2026-10-21 重导 `digital-kanghua-5e` 之后实测已对齐：
 * `regex_only 0 / col_only 0 / both 5` —— 正则分支在空转，留着只会造出
 * 「第二真源」这个负担（将来某本书的附录叫「题解汇编」时，读者会以为还要
 * 同步维护两处）。故删除，只读列。
 *
 * ## 为什么不在 SQL 里加 `NOT is_leaf`
 *
 * 列本身只可能标在非叶附件上（派生规则已含「必须是附件」）。如果在 SQL 里再
 * 加一道 `NOT is_leaf`，「叶节点被误标成答案附录」这种数据缺陷就会被静默
 * 降级成「不是答案附录」——错误数据继续躺在库里，只是没人被它影响。判据应该
 * 写进注释与导入管线，而不是用 SQL 掩盖数据问题。
 *
 * 也不把 5 个 id 写死：id 形如 `kp-kanghuaguang-5e-p573-部分习题答案`，
 * 写死会在重新 ingest 后静默失效（id 变了、条件还成立、没人会发现）。
 */
function isAnswerKeyNodeClause(): string {
  return 'kp.is_answer_key';
}

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);
  private cache: { key: string; index: ChunkIndex } | null = null;

  /**
   * 中英术语表（t32）。启动时读一次，挂在索引缓存旁。
   *
   * 读失败不抛错：没有词表的后果只是「中文 query 搜不到英文正文」，
   * 与修之前一样；抛错会让整个 API 起不来（包括与检索无关的页面）。
   */
  private readonly glossary: LoadedGlossary;

  /**
   * 语义检索（t82）。可选增强：构造是同步且不抛错的，只有第一次 `query()`
   * 才碰磁盘与网关。它不可用时 `retrieve()` 的结果与接语义之前逐位相同。
   */
  private readonly semantic = new SemanticSearch();

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {
    this.glossary = loadGlossary();
    if (this.glossary.loaded) {
      this.logger.log(
        `加载中英术语表：${this.glossary.entries.length} 个术语（${this.glossary.path}）`,
      );
    } else {
      this.logger.warn(`未加载中英术语表，中文 query 不会扩展到英文语料：${this.glossary.error}`);
    }

    const bus = db.connection;
    // 连接池继承 EventEmitter，可以直接挂监听；这样写入方（导入脚本、测试）
    // 只要 `db.connection.emit(CORPUS_CHANGED)`，下一次检索就会重建索引。
    (bus as unknown as EventEmitter).on(CORPUS_CHANGED, () => {
      this.cache = null;
    });
  }

  /** 当前索引（按 schema 缓存）。测试换 schema 会自动 miss。 */
  async getIndex(): Promise<ChunkIndex> {
    const key = this.db.activeSchema;
    if (this.cache && this.cache.key === key) return this.cache.index;

    const rows = await this.db.query<{
      id: string;
      micro_kp_id: string | null;
      source_id: string;
      source_title: string;
      kind: string;
      page: number | null;
      ordinal: number;
      text: string;
    }>(
      `SELECT c.id, c.micro_kp_id, c.source_id, s.title AS source_title,
              c.kind, c.page, c.ordinal, c.text
         FROM chunks c
         JOIN sources s ON s.id = c.source_id`,
    );

    const chunks: IndexedChunk[] = rows.map((r) => ({
      id: r.id,
      microKpId: r.micro_kp_id,
      sourceId: r.source_id,
      sourceTitle: r.source_title,
      kind: r.kind as IndexedChunk['kind'],
      page: r.page,
      ordinal: r.ordinal,
      text: r.text,
    }));

    const index = new ChunkIndex(chunks);
    this.cache = { key, index };
    this.logger.log(`建立检索索引：${index.size} 个切片（schema=${key}）`);
    return index;
  }

  /** 掌握度 `current`。无记录视为证据不足 → null → 最保守档。 */
  async currentMastery(microKpId: string): Promise<number | null> {
    const rows = await this.db.query<{ current: string }>(
      `SELECT current::text AS current FROM mastery WHERE micro_kp_id = $1`,
      [microKpId],
    );
    const value = rows[0]?.current;
    if (value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /**
   * 对**当前知识点**而言的答案块集合 = 两个来源的并集。
   *
   * 1. `chunk_kp_answer` 里显式标注给这个知识点的 chunk（原有路径，kp 级）；
   * 2. **全库所有**「答案附录」节点名下的全部 chunk（`isAnswerKeyNodeClause`）。
   *
   * 第 2 条不是锦上添花：那 4 个答案附录容器共 514 个 chunk，没有一条能被
   * 第 1 条查到 —— 实测 background 档 9.7% 的检索会放行附录里的原文。
   *
   * ## 为什么必须是并集而不是「有附录就只看附录」
   *
   * 附录之外的答案标注（散布在各章节习题里的解答）照样要拦。两条来源覆盖的是
   * 不同形态的答案，任何一条被丢掉都会留下整类泄漏。
   *
   * ## 为什么第 2 条**不**做同书过滤（这条曾经写错过）
   *
   * 第一版要求「附录节点与当前知识点同 `source_id`」，理由是「A 书的附录不能
   * 影响 B 书的门控」。这个理由本身对，但它推出的是「不要用 A 书的附录去标记
   * B 书的**普通** chunk」，而不是「B 书的答案附录对 A 书的学习者就不算答案」。
   *
   * 一个 chunk 是不是答案，取决于**它自己属于哪个节点**，不取决于**提问的人
   * 正在看哪本书**。按同书过滤时实测：当前知识点在阎石书上能拦住阎石书的
   * 附录，换成王芝英书的叶节点问同一句，同一块答案原文就放行了 —— 300 次
   * 探针里 29 次（9.7%）仍然泄漏，与修之前一模一样。
   *
   * 所以第 2 条是**无条件**的：`is_answer_key` 节点的全部 chunk 对任何知识点
   * 都是答案块。判空也一并去掉 —— 它原本唯一的作用是防止 `NULL = NULL` 的
   * 三值逻辑把无源知识点串成一本「书」，没有 join 就不需要了。
   *
   * ## 为什么不进 `getIndex()` 的缓存
   *
   * `getIndex` 按 schema 缓存，失效靠 `CORPUS_CHANGED`。答案附录集合跟着内容
   * 变更走（重新 ingest 会改动哪些节点是附录、哪些 chunk 属于它），塞进按
   * schema 失效的缓存里会漏失效 —— 表现为「库更新了，门控还按旧附录算」。
   * 这条查询只扫 `is_answer_key` 的 partial index（全库 4 行），每次检索都查。
   */
  async answerChunkIdsFor(microKpId: string): Promise<Set<string>> {
    const rows = await this.db.query<{ id: string }>(
      `WITH RECURSIVE answer_roots AS (
         SELECT kp.id FROM knowledge_points kp WHERE ${isAnswerKeyNodeClause()}
       ),
       -- 附录容器本身可能还有子节点（当前语料里没有，但 ingest 会把 chunk
       -- 挂到树上任意一层）。递归下去，才不会因为「这台书上恰好没有子节点」
      -- 而让实现看起来对、换一本书就漏。
       subtree AS (
         SELECT id FROM answer_roots
         UNION ALL
         SELECT kp.id FROM knowledge_points kp JOIN subtree s ON kp.parent_id = s.id
       )
       SELECT chunk_id AS id FROM chunk_kp_answer WHERE micro_kp_id = $1
       UNION
       SELECT c.id AS id FROM chunks c JOIN subtree s ON s.id = c.micro_kp_id`,
      [microKpId],
    );
    return new Set(rows.map((r) => r.id));
  }

  async assertKnowledgePointExists(microKpId: string): Promise<{ id: string; name: string }> {
    const rows = await this.db.query<{ id: string; name: string }>(
      `SELECT id, name FROM knowledge_points WHERE id = $1`,
      [microKpId],
    );
    const node = rows[0];
    if (!node) throw new Error(`知识点不存在: ${microKpId}`);
    return node;
  }

  /**
   * 检索 + 门控。
   *
   * 门控**发生在检索层**：返回值里 `allowed` 与 `excluded` 是两个集合，
   * 上层（提示词组装）只能拿 `allowed`。这样「答案块不进上下文」是调用方
   * 拿不到，而不是「说好了不要用」。
   */
  async retrieve(params: {
    query: string;
    microKpId: string;
    /** 覆盖掌握度（检索调试器用来看三档差异）；不传则读库 */
    currentOverride?: number | null;
    candidateLimit?: number;
  }): Promise<RetrievalOutcome> {
    const index = await this.getIndex();
    const current =
      params.currentOverride !== undefined
        ? params.currentOverride
        : await this.currentMastery(params.microKpId);
    const tier = gateTierFor(current);
    const answerIds = await this.answerChunkIdsFor(params.microKpId);

    // 跨语言扩展（t32）：中文 query 在英文正文里零命中，先展开成英文术语。
    // 纯英文 query 返回空（见 `expandQuery` 文件头），中文书不受影响。
    const expanded = expandQuery(params.query, this.glossary.entries as readonly GlossaryEntry[]);
    const extraTerms = expanded.terms;

    const matches = index.search(params.query, {
      hardCap: params.candidateLimit ?? 200,
      extraTerms: extraTerms,
    });

    // 语义重排（t82）：**只改顺序、不新增候选**。
    //
    // 候选集仍由 BM25 决定，向量只在这同一批候选上给出「像不像」的分。
    // 这样做有两个后果，都是刻意的：
    // ①「三档允许集合之差恰好等于答案块集合」这条门控不变量不受影响
    //   （它只依赖候选集与答案块集合，不依赖顺序）；
    // ② 语义检索失效时（向量库没建、网关不通）结果与接之前逐位相同，
    //   而不是「少了几条」—— 降级必须是可对照的。
    const semanticStatus = this.semantic.status();
    let semanticReranked = 0;
    if (semanticStatus.enabled && matches.length > 0) {
      const hits = await this.semantic.query(params.query, Math.max(matches.length, 50));
      if (hits.length > 0) {
        const vectorById = new Map(hits.map((h) => [h.chunkId, h.score]));
        const maxLexical = matches.reduce((max, m) => Math.max(max, m.score), 0);
        let touched = 0;
        for (const match of matches) {
          const vector = vectorById.get(match.chunk.id);
          if (vector === undefined) continue;
          match.score = blendScores(match.score, vector, maxLexical);
          touched += 1;
        }
        semanticReranked = touched;
        if (touched > 0) matches.sort((a, b) => b.score - a.score);
      }
    }

    const candidates: CandidateChunk[] = matches.map((m) => ({
      id: m.chunk.id,
      microKpId: m.chunk.microKpId,
      sourceId: m.chunk.sourceId,
      sourceTitle: m.chunk.sourceTitle,
      kind: m.chunk.kind,
      page: m.chunk.page,
      ordinal: m.chunk.ordinal,
      text: m.chunk.text,
      score: m.score,
    }));

    // 第一道：答案块（engine 的权威实现，含逐块理由）
    const gateable = candidates.map((c) => ({ id: c.id, kind: c.kind, text: c.text, candidate: c }));
    const answerDecision = filterChunks(gateable, answerIds, tier);
    const allowedIds = new Set(answerDecision.allowed.map((g) => g.id));
    const answerReasons = new Map(answerDecision.excluded.map((e) => [e.id, e.reason]));

    // 第二道：档位形态（背景档排除公式与表格）
    const shape = applyTierShape(
      gateable.filter((g) => allowedIds.has(g.id)),
      tier,
    );
    const shapeAllowed = new Set(shape.allowed.map((g) => g.id));
    const shapeReasons = new Map(shape.excluded.map((e) => [e.id, e.reason]));

    const gated: GatedChunk[] = candidates.map((c) => {
      const isAnswerChunk = answerIds.has(c.id);
      const blockedByAnswer = answerReasons.get(c.id);
      const blockedByShape = shapeReasons.get(c.id);
      const allowed = allowedIds.has(c.id) && shapeAllowed.has(c.id);
      return {
        ...c,
        isAnswerChunk,
        allowed,
        tier,
        exclusionReason: allowed ? null : (blockedByAnswer ?? blockedByShape ?? '未通过门控'),
      };
    });

    return {
      tier,
      current,
      candidates,
      gated,
      allowed: gated.filter((g) => g.allowed),
      excluded: gated.filter((g) => !g.allowed),
      answerChunkIds: [...answerIds],
      expansions: expanded.expansions,
      extraTerms,
      semantic: {
        enabled: semanticStatus.enabled,
        reason: semanticStatus.reason,
        reranked: semanticReranked,
      },
    };
  }

  /**
   * 摘要文本（命中词附近取上下文）。
   *
   * `extraTerms` 必传：中文 query 命中的是英文正文，只用中文 token 找命中点
   * 会找不到，摘要退回「从头截」。默认空数组是为了让旧调用点（无扩展）不变。
   */
  snippet(text: string, query: string, extraTerms: readonly string[] = []): string {
    return buildSnippet(text, query, 160, extraTerms);
  }
}
