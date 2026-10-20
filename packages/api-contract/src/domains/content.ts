/**
 * 内容库领域契约：统计读数与来源可追溯。
 *
 * 归属泳道：content-dev。领域文件由该泳道增改，`src/index.ts` 的 re-export 行
 * 已经预先写好，加 schema 不需要动共享文件。
 */
import { z } from 'zod';

/**
 * 数据库展示页的统计。四项计数是票 02 的验收要求：
 * 知识点数量、chunk 数量、答案块数量、以及来源可追溯性。
 */
export const ContentStatsResponseSchema = z.object({
  sources: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      kind: z.enum(['book', 'paper', 'video', 'other']),
      chunkCount: z.number().int().min(0),
      answerChunkCount: z.number().int().min(0),
      pageFrom: z.number().int().nullable(),
      pageTo: z.number().int().nullable(),
    }),
  ),
  knowledgePoints: z.object({
    total: z.number().int().min(0),
    leaves: z.number().int().min(0),
  }),
  chunks: z.object({
    total: z.number().int().min(0),
    byKind: z.record(z.string(), z.number().int().min(0)),
  }),
  answers: z.number().int().min(0),
  edges: z.object({
    total: z.number().int().min(0),
    withEvidence: z.number().int().min(0),
  }),
});

/** GET /api/v1/nodes/:microKpId/sources —— 任取一个知识点，能看到它出自哪几页 */
export const NodeSourcesResponseSchema = z.object({
  microKpId: z.string(),
  name: z.string(),
  pages: z.array(z.number().int()),
  chunks: z.array(
    z.object({
      chunkId: z.string(),
      kind: z.enum(['text', 'formula', 'figure', 'table']),
      page: z.number().int().nullable(),
      isAnswer: z.boolean(),
      excerpt: z.string(),
    }),
  ),
});

export type ContentStatsResponse = z.infer<typeof ContentStatsResponseSchema>;
export type NodeSourcesResponse = z.infer<typeof NodeSourcesResponseSchema>;
