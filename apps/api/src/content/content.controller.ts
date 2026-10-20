import { Controller, Get, Inject, NotFoundException, Param, UseFilters } from '@nestjs/common';
import {
  ContentStatsResponseSchema,
  NodeSourcesResponseSchema,
  type ContentStatsResponse,
  type NodeSourcesResponse,
} from '@starmap/api-contract';
import { DatabaseService } from '../db/database.service.js';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';

/**
 * 数据库展示页的读数端。
 *
 * 与 NodesController 分开的理由：Nodes 回答的是「学什么」，这个回答的是
 * 「库里到底有什么、可信度如何」。前者是学习流程的一部分，后者是检视工具，
 * 两者的失效后果也不同——课程数据错了要修，统计数字错了先看到再修。
 *
 * 这里全部是聚合查询，没有写操作。工具页不需要 SQL 控制台（spec OQ4）：
 * 一个能跑任意 SQL 的框，在这个应用里既无用又危险。
 */
@Controller('api/v1')
@UseFilters(ApiExceptionFilter)
export class ContentController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  @Get('content/stats')
  async stats(): Promise<ContentStatsResponse> {
    const [sourceRows, kpRows, chunkRows, answerRow, byKindRows, edgeRows] = await Promise.all([
      this.db.query<{
        id: string;
        title: string;
        kind: string;
        chunk_count: string;
        answer_count: string;
        page_from: number | null;
        page_to: number | null;
      }>(
        `SELECT s.id, s.title, s.kind,
                -- 必须 DISTINCT：join chunk_kp_answer 会把同一个 chunk 按
                -- 「对几个知识点是答案」复制成几行。不 DISTINCT 的话，
                -- 一个切片对 3 个知识点是答案，chunkCount 就变成 3。
                count(DISTINCT c.id)::text AS chunk_count,
                count(DISTINCT a.chunk_id)::text AS answer_count,
                min(c.page) AS page_from,
                max(c.page) AS page_to
           FROM sources s
           LEFT JOIN chunks c ON c.source_id = s.id
           LEFT JOIN chunk_kp_answer a ON a.chunk_id = c.id
          GROUP BY s.id, s.title, s.kind
          ORDER BY s.id`,
      ),
      this.db.query<{ total: string; leaves: string }>(
        `SELECT count(*)::text AS total,
                count(*) FILTER (WHERE is_leaf)::text AS leaves
           FROM knowledge_points`,
      ),
      this.db.query<{ total: string }>(`SELECT count(*)::text AS total FROM chunks`),
      this.db.query<{ total: string }>(
        `SELECT count(DISTINCT chunk_id)::text AS total FROM chunk_kp_answer`,
      ),
      this.db.query<{ kind: string; n: string }>(
        `SELECT kind, count(*)::text AS n FROM chunks GROUP BY kind ORDER BY kind`,
      ),
      this.db.query<{ total: string; with_evidence: string }>(
        `SELECT count(*)::text AS total,
                count(*) FILTER (
                  WHERE jsonb_typeof(evidence_detail) = 'array'
                    AND jsonb_array_length(evidence_detail) > 0
                )::text AS with_evidence
           FROM kp_edges WHERE kind = 'prereq'`,
      ),
    ]);

    const kp = kpRows[0];
    const chunk = chunkRows[0];
    const edge = edgeRows[0];

    return ContentStatsResponseSchema.parse({
      sources: sourceRows.map((s) => ({
        id: s.id,
        title: s.title,
        kind: s.kind as 'book' | 'paper' | 'video' | 'other',
        chunkCount: Number(s.chunk_count),
        // 注意是 chunk 数不是关系行数：一个 chunk 对 3 个知识点是答案，
        // 对使用者仍然是「1 个答案切片」，报 3 会让人以为库里有 3 份。
        answerChunkCount: Number(s.answer_count),
        pageFrom: s.page_from,
        pageTo: s.page_to,
      })),
      knowledgePoints: {
        total: Number(kp?.total ?? 0),
        leaves: Number(kp?.leaves ?? 0),
      },
      chunks: {
        total: Number(chunk?.total ?? 0),
        byKind: Object.fromEntries(byKindRows.map((r) => [r.kind, Number(r.n)])),
      },
      answers: Number(answerRow[0]?.total ?? 0),
      edges: {
        total: Number(edge?.total ?? 0),
        withEvidence: Number(edge?.with_evidence ?? 0),
      },
    });
  }

  /**
   * 任取一个知识点，返回它的来源页与切片。
   *
   * 这个端点是票 02「可追溯」验收的具体形式：不是「我们记录了页码」，
   * 而是「点开任何一个知识点，能看到它出自第几页的哪几段」。
   */
  @Get('nodes/:microKpId/sources')
  async sources(@Param('microKpId') microKpId: string): Promise<NodeSourcesResponse> {
    const nodes = await this.db.query<{ id: string; name: string; is_leaf: boolean }>(
      `SELECT id, name, is_leaf FROM knowledge_points WHERE id = $1`,
      [microKpId],
    );
    const node = nodes[0];
    if (!node) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `知识点不存在: ${microKpId}`,
      });
    }

    // 非叶节点没有自己的 chunk（归属只落到叶节点），改为汇总子树的。
    const chunks = await this.db.query<{
      id: string;
      kind: string;
      page: number | null;
      text: string;
      is_answer: boolean;
    }>(
      `WITH RECURSIVE subtree AS (
         SELECT id FROM knowledge_points WHERE id = $1
         UNION ALL
         SELECT k.id FROM knowledge_points k JOIN subtree s ON k.parent_id = s.id
       )
       SELECT c.id, c.kind, c.page, c.text,
              (a.chunk_id IS NOT NULL) AS is_answer
         FROM chunks c
         JOIN subtree s ON s.id = c.micro_kp_id
         LEFT JOIN chunk_kp_answer a ON a.chunk_id = c.id AND a.micro_kp_id = c.micro_kp_id
        ORDER BY c.page, c.ordinal`,
      [microKpId],
    );

    const pages = [...new Set(chunks.map((c) => c.page).filter((p): p is number => p !== null))].sort(
      (a, b) => a - b,
    );

    return NodeSourcesResponseSchema.parse({
      microKpId,
      name: node.name,
      pages,
      chunks: chunks.map((c) => ({
        chunkId: c.id,
        kind: c.kind as 'text' | 'formula' | 'figure' | 'table',
        page: c.page,
        isAnswer: c.is_answer,
        // 列表页只需要看个开头；完整文本留给检索结果展示（票 09）
        excerpt: c.text.length > 120 ? `${c.text.slice(0, 120)}…` : c.text,
      })),
    });
  }
}
