import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Query,
  UseFilters,
} from '@nestjs/common';
import { z } from 'zod';
import {
  RetrievalBandsResponseSchema,
  RetrievalDebugResponseSchema,
  type RetrievalBand,
  type RetrievalBandsResponse,
  type RetrievalDebugResponse,
} from '@starmap/api-contract';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { RetrievalService } from './retrieval.service.js';

const DebugQuerySchema = z.object({
  query: z.string().min(1),
  microKpId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const BandsQuerySchema = z.object({
  query: z.string().min(1),
  microKpId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * 三档代表值。
 *
 * 用 0.2 / 0.55 / 0.85 而不是 0.4 与 0.7 本身：边界值落在阈值上，
 * 一旦 `gateTierFor` 的比较符从 `<` 改成 `<=`，用边界值做的测试会**跟着
 * 实现一起变**，测不出任何东西。取档内中值是故意的。
 */
const BAND_CURRENTS = [0.2, 0.55, 0.85] as const;

/**
 * 检索调试器（票 09）。
 *
 * 为什么不是「内部工具命令行」而是页面上的两个端点：门控是这个系统里最容易
 * 悄悄失效的部分——它失效时没有任何报错，只是答案悄悄进了提示词。把它做成
 * 一个「点开就能看见每个切片为什么被排除」的页面，是把这种失效变成可观察的。
 */
@Controller('api/v1')
@UseFilters(ApiExceptionFilter)
export class RetrievalController {
  constructor(@Inject(RetrievalService) private readonly retrieval: RetrievalService) {}

  /**
   * GET /api/v1/agent/retrieval/debug
   *
   * 返回命中切片，每条都带 `isAnswerChunk` / `allowed` / `exclusionReason`。
   * `hits` 按分数截断到 `limit`，但 `totalMatched` 是未截断的总数——
   * 否则「搜到 3 条」和「只显示了 3 条」会混为一谈。
   */
  @Get('agent/retrieval/debug')
  async debug(@Query() rawQuery: unknown): Promise<RetrievalDebugResponse> {
    const parsed = DebugQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '查询参数不合法',
        details: parsed.error.issues,
      });
    }
    const { query, microKpId, limit } = parsed.data;

    // 知识点必须存在：不存在时检索会返回空集，而空集看起来像「门控把一切都
    // 排除了」。这个错误必须响，不能静默。
    await this.assertKp(microKpId);

    const outcome = await this.retrieval.retrieve({ query, microKpId });

    return RetrievalDebugResponseSchema.parse({
      query,
      microKpId,
      current: outcome.current,
      gateTier: outcome.tier,
      hits: outcome.gated.slice(0, limit).map((hit) => ({
        chunkId: hit.id,
        microKpId: hit.microKpId,
        score: round4(hit.score),
        snippet: this.retrieval.snippet(hit.text, query, outcome.extraTerms),
        kind: hit.kind,
        page: hit.page,
        sourceTitle: hit.sourceTitle,
        isAnswerChunk: hit.isAnswerChunk,
        allowed: hit.allowed,
        tier: hit.tier,
        exclusionReason: hit.exclusionReason,
      })),
      totalMatched: outcome.candidates.length,
      answerChunkCount: outcome.candidates.filter((c) => outcome.answerChunkIds.includes(c.id)).length,
      excludedCount: outcome.excluded.length,
      expansions: outcome.expansions,
    });
  }

  /**
   * GET /api/v1/agent/retrieval/bands
   *
   * 同一个 query 在三个 current 下的允许集合。票 09 要的不变量是
   * 「scaffold 与 full 的差集恰好等于答案块集合」——一次返回三档，
   * 测试和页面都不用自己跑三遍再对齐。
   */
  @Get('agent/retrieval/bands')
  async bands(@Query() rawQuery: unknown): Promise<RetrievalBandsResponse> {
    const parsed = BandsQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '查询参数不合法',
        details: parsed.error.issues,
      });
    }
    const { query, microKpId, limit } = parsed.data;

    await this.assertKp(microKpId);

    const outcomes = await Promise.all(
      BAND_CURRENTS.map((current) =>
        this.retrieval.retrieve({ query, microKpId, currentOverride: current }),
      ),
    );

    const bands: RetrievalBand[] = outcomes.map((outcome) => {
      // limit 在这里是把三档的展示集合收敛到同一批候选：三档之间必须能逐条
      // 对比，若各档各自取 top-N，差集就混进了「本来只是排在后面」的切片。
      const shown = outcome.gated.slice(0, limit);
      return {
        current: outcome.current ?? 0,
        gateTier: outcome.tier,
        allowedIds: shown.filter((g) => g.allowed).map((g) => g.id),
        excludedIds: shown.filter((g) => !g.allowed).map((g) => g.id),
      };
    });

    return RetrievalBandsResponseSchema.parse({
      query,
      microKpId,
      answerChunkIds: outcomes[0]?.answerChunkIds ?? [],
      bands,
      expansions: outcomes[0]?.expansions ?? [],
    });
  }

  private async assertKp(microKpId: string): Promise<void> {
    try {
      await this.retrieval.assertKnowledgePointExists(microKpId);
    } catch {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `知识点不存在: ${microKpId}` });
    }
  }
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
