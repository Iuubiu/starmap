import { z } from 'zod';

export const ChunkSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  ordinal: z.number().int().min(0),
  text: z.string(),
  /** 便于检索调试器展示 */
  pageFrom: z.number().int().nullable(),
  pageTo: z.number().int().nullable(),
  kind: z.enum(['text', 'formula', 'figure', 'table']),
});
export type Chunk = z.infer<typeof ChunkSchema>;

export const SourceSchema = z.object({
  id: z.string(),
  kind: z.enum(['book', 'paper', 'video']),
  title: z.string(),
  authors: z.array(z.string()),
  year: z.number().int().nullable(),
  /** books 的 A/B/C/D 分级，papers 为空 */
  tier: z.enum(['A', 'B', 'C', 'D']).nullable(),
  /** 教材的课程归属，例如 'nuclear-electronics' */
  course: z.string().nullable(),
  pageCount: z.number().int().nullable(),
});
export type Source = z.infer<typeof SourceSchema>;

export const RetrievalHitSchema = z.object({
  chunkId: z.string(),
  microKpId: z.string(),
  score: z.number(),
  snippet: z.string(),
  /** 检索门控结论；被排除时必须给出理由，供检索调试器展示 */
  gate: z.object({
    allowed: z.boolean(),
    tier: z.enum(['background', 'scaffold', 'full']),
    reason: z.string(),
  }),
});
export type RetrievalHit = z.infer<typeof RetrievalHitSchema>;

export const RetrievalRequestSchema = z.object({
  query: z.string().min(1),
  microKpId: z.string(),
  limit: z.number().int().min(1).max(50).default(10),
});
export type RetrievalRequest = z.infer<typeof RetrievalRequestSchema>;

export const RetrievalResponseSchema = z.object({
  /** 当前掌握度决定的门控档位 */
  gateTier: z.enum(['background', 'scaffold', 'full']),
  hits: z.array(RetrievalHitSchema),
  totalMatched: z.number().int(),
});
export type RetrievalResponse = z.infer<typeof RetrievalResponseSchema>;
