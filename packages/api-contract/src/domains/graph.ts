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

/**
 * 图谱上一个叶节点（微知识点）的完整事实。
 *
 * 与 `NodeStateSchema` 的区别：那个是「列表里的一行」，只需要能显示；
 * 这个是「画布上的一个点」，额外带上做布局与主线排序需要的位置信息
 * （模块与模块内序），以及复验排期。**两者刻意不合并**：列表接口被
 * 看板复用（每页 50 个，不该多背三个字段），图谱一次拉全量（2000+ 个），
 * 两个接口的取舍方向相反。
 *
 * `moduleName` / `moduleOrdinal` 是为了「线性主线视图」——主线顺序 = 模块
 * 序 → 树深 → 模块内序 → id，客户端必须拿到前三个才能排，否则要为了
 * 排序再发一次请求。
 */
export const GraphNodeSchema = z.object({
  microKpId: z.string(),
  name: z.string(),
  state: MasteryStateSchema,
  /** 证据不足时为 null，语义与 NodeStateSchema.percent 一致 */
  percent: z.number().min(0).max(1).nullable(),
  depth: z.number().int().min(0),
  moduleId: z.string(),
  moduleName: z.string(),
  moduleOrdinal: z.number().int(),
  /** 模块内的兄弟序，与 depth、id 一起决定主线次序 */
  ordinal: z.number().int(),
  /**
   * 复验到期时间（ISO 8601）。null = 没有排期（还没掌握，或排期表还没写）。
   *
   * 这个字段的**写入方是票 07**（间隔 1/3/7/21/60 天的排期器），本票只读。
   * 票 07 的验收第 5 条要求「图谱上『需复验』状态与到期判定一致」，做到
   * 这一点的唯一办法是两边共用同一列，而不是各算一套：所以这里暴露排期
   * 时间戳本身，而不是一个由本服务自行推断的 `needsReview` 布尔。前端把
   * 「到期」的判定放在一个纯函数里（`toDisplayStatus`），与票 07 的抽考
   * 选择共用同一个 `<= now` 比较。
   *
   * 该列尚未被任何写路径填过时恒为 null，图谱上就不会出现「需复验」色的
   * 节点 —— 这是正确的：没有排期就没有到期。
   */
  reviewDueAt: z.string().nullable(),
});

/** 图谱上的一条有向边。目前只有先修（`from` 必须先学）一类有数据。 */
export const GraphEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(['prereq', 'related', 'part_of']),
});

/**
 * GET /api/v1/graph —— 一次返回整张图。
 *
 * 为什么不分页：画布要算力导向布局，缺一半节点的图布局会跳；而且两跳邻域
 * 的计算必须在完整邻接表上做（只看局部会漏掉「邻居的邻居」）。2000 个节点
 * + 数千条边的 JSON 约 300 KB，一次拉完比按需拼接简单也更快。
 */
export const GraphResponseSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});

export type MasteryState = z.infer<typeof MasteryStateSchema>;
export type NodeState = z.infer<typeof NodeStateSchema>;
export type NodeListResponse = z.infer<typeof NodeListResponseSchema>;
export type NodeDetailResponse = z.infer<typeof NodeDetailResponseSchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type GraphResponse = z.infer<typeof GraphResponseSchema>;
