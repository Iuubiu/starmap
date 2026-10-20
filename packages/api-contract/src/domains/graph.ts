/**
 * 图谱领域契约：节点、掌握状态、节点列表/详情。
 *
 * 归属泳道：graph-dev。领域文件由该泳道增改，`src/index.ts` 的 re-export 行
 * 已经预先写好，加 schema 不需要动共享文件。
 *
 * 掌握度只在叶节点持有（ADR-0004），非叶节点的颜色由子节点聚合，所以这里
 * 只有「节点自身状态」，没有「聚合状态」——聚合是纯展示派生，不进契约。
 */
import { z } from 'zod';
import { LevelSummarySchema } from './levels.js';

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

export type MasteryState = z.infer<typeof MasteryStateSchema>;
export type NodeState = z.infer<typeof NodeStateSchema>;
export type NodeListResponse = z.infer<typeof NodeListResponseSchema>;
export type NodeDetailResponse = z.infer<typeof NodeDetailResponseSchema>;
