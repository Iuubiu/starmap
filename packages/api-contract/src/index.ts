/**
 * 契约唯一真源（ADR-0006）。
 *
 * 链条：这里的 Zod schema → `openapi.yaml`（入库）→ Orval 生成前端客户端。
 * 前端不得手写与后端重复的类型；后端也不得绕过这里直接定义响应形状。
 *
 * 注意：Zod 是**内部**真源，`openapi.yaml` 是**对外**契约。两者都要入库，
 * 且 CI 必须校验它们同步——因为外部消费者（以及未来的移动端）只认 yaml。
 */
import { z } from 'zod';

export const ErrorCodeSchema = z.enum([
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'CONFLICT',
  'UPSTREAM_UNAVAILABLE',
  'INTERNAL',
]);

export const ApiErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});

/** 节点状态：由 mastery 派生，不落库 */
export const MasteryStateSchema = z.enum([
  'mastered',
  'proficient',
  'familiar',
  'attempted',
  'unseen',
]);

export const NodeStateSchema = z.object({
  microKpId: z.string(),
  name: z.string(),
  state: MasteryStateSchema,
  /** 证据不足时为 null，不是 0——「不知道」和「零分」是两件事 */
  percent: z.number().min(0).max(1).nullable(),
  depth: z.number().int().min(0),
});

export const LevelSummarySchema = z.object({
  levelId: z.string(),
  microKpId: z.string(),
  title: z.string(),
  itemCount: z.number().int().min(0),
  kind: z.enum(['teach', 'quiz', 'mixed']),
});

/** GET /api/v1/health */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  /** 便于「骨架跑通」时用肉眼确认连的是真库 */
  dbNow: z.string(),
  version: z.string(),
});

/** GET /api/v1/nodes */
export const NodeListResponseSchema = z.object({
  items: z.array(NodeStateSchema),
  nextCursor: z.string().nullable(),
});

/** GET /api/v1/nodes/:microKpId */
export const NodeDetailResponseSchema = z.object({
  node: NodeStateSchema,
  levels: z.array(LevelSummarySchema),
  /** 一句话说明「为什么推荐这个」，前端直接展示 */
  reasons: z.array(z.string()),
});

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

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ContentStatsResponse = z.infer<typeof ContentStatsResponseSchema>;
export type NodeSourcesResponse = z.infer<typeof NodeSourcesResponseSchema>;
export type NodeListResponse = z.infer<typeof NodeListResponseSchema>;
export type NodeDetailResponse = z.infer<typeof NodeDetailResponseSchema>;
export type LevelSummary = z.infer<typeof LevelSummarySchema>;
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;
