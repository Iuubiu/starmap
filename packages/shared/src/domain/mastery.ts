import { z } from 'zod';

/**
 * 掌握度只挂在微知识点叶节点上（ADR-0004）。
 * `achieved` 不衰减，管解锁；`current` 衰减，管推荐与检索门控。
 */
export const MasterySchema = z.object({
  microKpId: z.string().min(1),
  achieved: z.number().min(0).max(1),
  current: z.number().min(0).max(1),
  /** 生效的作答次数（平行题不重复计数） */
  attemptCount: z.number().int().min(0),
  /** 不同变式组的数量 */
  variantCount: z.number().int().min(0),
  /** 是否达到报告掌握的硬门槛（≥3 变式、≥8 次作答且 achieved 过阈） */
  evidenceSufficient: z.boolean(),
  updatedAt: z.string(),
});
export type Mastery = z.infer<typeof MasterySchema>;

export const MasteryStateSchema = z.enum(['mastered', 'proficient', 'familiar', 'attempted', 'unseen']);
export type MasteryState = z.infer<typeof MasteryStateSchema>;

/** 节点在图上呈现的状态；由 mastery 派生，不落库 */
export const NodeStateSchema = z.object({
  microKpId: z.string(),
  name: z.string(),
  state: MasteryStateSchema,
  /** 派生而来的百分比；证据不足时为 null，而非 0 */
  percent: z.number().min(0).max(1).nullable(),
  depth: z.number().int().min(0),
});
export type NodeState = z.infer<typeof NodeStateSchema>;

export const MicroKpSchema = z.object({
  id: z.string(),
  name: z.string(),
  moduleId: z.string(),
  parentId: z.string().nullable(),
  isLeaf: z.boolean(),
  summary: z.string().nullable(),
  /** 章节内序号，用于线性退路 */
  ordinal: z.number().int(),
});
export type MicroKp = z.infer<typeof MicroKpSchema>;

export const KpEdgeSchema = z.object({
  fromId: z.string(),
  toId: z.string(),
  kind: z.enum(['prereq', 'related', 'part_of']),
  /** 先修边必须有证据来源，否则不能作为门控依据 */
  evidence: z.string().nullable(),
});
export type KpEdge = z.infer<typeof KpEdgeSchema>;
