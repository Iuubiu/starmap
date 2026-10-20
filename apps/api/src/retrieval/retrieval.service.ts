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
}

/**
 * 门控阈值。**必须与 `packages/engine/src/retrieval-gate.ts` 的
 * `GATE_THRESHOLDS` 一致** —— 那边是权威定义，这里是转述。
 *
 * 为什么这里还要写一份：engine 的 `filterChunks` 只做「答案块放不放行」，
 * 而 background 档还要额外排除公式与表格（见 `applyTierShape`）。阈值本身
 * 两边必须同源，所以干脆 import 过来，不自己写数字。
 */
import { GATE_THRESHOLDS, gateTierFor, filterChunks } from '@starmap/engine';
import { ChunkIndex, buildSnippet, type IndexedChunk } from './bm25.js';

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

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);
  private cache: { key: string; index: ChunkIndex } | null = null;

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {
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
   * 对**当前知识点**而言的答案块集合。
   *
   * 这是整个门控的支点：`chunk_kp_answer` 是 (chunk, 知识点) 关系，
   * 同一个 chunk 对 A 是答案、对 B 是背景，两种结论同时成立（ADR-0001）。
   */
  async answerChunkIdsFor(microKpId: string): Promise<Set<string>> {
    const rows = await this.db.query<{ chunk_id: string }>(
      `SELECT chunk_id FROM chunk_kp_answer WHERE micro_kp_id = $1`,
      [microKpId],
    );
    return new Set(rows.map((r) => r.chunk_id));
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

    const matches = index.search(params.query, { hardCap: params.candidateLimit ?? 200 });
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
    };
  }

  /** 摘要文本（命中词附近取上下文）。 */
  snippet(text: string, query: string): string {
    return buildSnippet(text, query);
  }
}
