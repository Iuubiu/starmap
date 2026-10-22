/**
 * 个人看板（票 80）：三级进度条的数据形状。
 *
 * 归属泳道：agent-dev。
 *
 * ## 为什么分母必须出现在契约里，而不是让前端自己算
 *
 * 「学了多少」这个问题只有在有分母时才成立。3,000 多个叶节点里掌握了 7 个，
 * 和掌握了 7 个而库里有 20 个，是两个完全不同的处境。前端拿不到分母就只能
 * 显示一个没有意义的百分比（或者更糟：拿当前页的条数当分母）。所以 `total`
 * 与分子一起从后端来，且**同一响应里的所有分子共享同一个 `evaluatedAt`**。
 *
 * ## 为什么分子不是从 `app.mastery` 读的
 *
 * 那张表里的 `current` 是「上次作答那一刻」的值；掌握度按半衰期衰减，直接
 * 用它统计等于把上次计算的时刻当成现在。服务端对每个叶节点重放作答历史
 * （`MasteryService.viewMany`），这里只是把这些重放结果按三个维度分组计数。
 *
 * ## 五态与「在学」
 *
 * 状态词表与 `MasteryView.state` 同源（`mastered / proficient / familiar /
 * attempted / unseen`）。看板把后四态压成两组：
 *
 * - `mastered`：已掌握
 * - `learning`：在学（proficient + familiar + attempted）
 * - `untouched`：未学（unseen）
 *
 * 三数之和恒等于 `total`。`byState` 给出未合并的五态，界面要按五态画图时
 * 用它，不要自己再推导一遍。
 */
import { z } from 'zod';

/** 掌握度五态。顺序即展示顺序：从已掌握到未学习。 */
export const ProgressMasteryStateSchema = z.enum([
  'mastered',
  'proficient',
  'familiar',
  'attempted',
  'unseen',
]);

export type ProgressMasteryState = z.infer<typeof ProgressMasteryStateSchema>;

/** 五态各自的叶节点数。 */
export const ProgressStateCountSchema = z.object({
  state: ProgressMasteryStateSchema,
  count: z.number().int().min(0),
});

/** 一级：知识点进度（全库叶节点）。 */
export const KnowledgePointProgressSchema = z.object({
  /** 全库叶节点总数（分母）。与 `SELECT count(*) ... WHERE is_leaf` 逐位相等 */
  total: z.number().int().min(0),
  /** 已掌握 */
  mastered: z.number().int().min(0),
  /** 在学：proficient + familiar + attempted */
  learning: z.number().int().min(0),
  /** 未学：unseen */
  untouched: z.number().int().min(0),
  /** 五态明细，恒有 5 项、按 `ProgressMasteryStateSchema` 的顺序 */
  byState: z.array(ProgressStateCountSchema).length(5),
});

/**
 * 二级：学科进度（`app.course_layers` 的 8 层）。
 *
 * `total` 是**该层内的**叶节点数，各层之和 + `unlayeredLeafCount` = 全库叶节点。
 * 不要把它和一级的 `total` 混用：库里有 1,000 多个知识点还没归入课程层
 * （布尔代数、卡诺图这类散落的基础点），层内分母天然小于全库。
 */
export const LayerProgressSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** `course_layers.ordinal`：界面的层顺序以它为准，不按名字排 */
  ordinal: z.number().int(),
  /** 该层叶节点总数（分母） */
  total: z.number().int().min(0),
  /** 该层已掌握的叶节点数 */
  mastered: z.number().int().min(0),
});

/**
 * 三级：课本进度（`app.sources` 里 `kind='book'` 的 27 本）。
 *
 * 已停用的英文原版书 `enabled=false`、`total=0`（没有知识点指向它们）。
 * 界面要按 `enabled` 把它们单列并标「已停用」，而不是画一条 0/0 的进度条。
 */
export const BookProgressSchema = z.object({
  id: z.string(),
  title: z.string(),
  enabled: z.boolean(),
  /** 该书叶节点总数（分母）。停用书为 0 */
  total: z.number().int().min(0),
  /** 已学过的知识点数（state !== 'unseen'） */
  learned: z.number().int().min(0),
});

/** `GET /api/v1/mastery/board` 的响应。 */
export const ProgressBoardSchema = z.object({
  /** 本次回放采用的评估时刻（UTC 日界）。同一响应里的所有数字都属于这一刻 */
  evaluatedAt: z.string(),
  knowledgePoints: KnowledgePointProgressSchema,
  /** 按 `ordinal` 升序，8 行 */
  layers: z.array(LayerProgressSchema),
  /** 启用的在前、停用的在后；同组按书名 */
  books: z.array(BookProgressSchema),
  /**
   * 没归入任何课程层的叶节点数。
   *
   * 这个数存在的原因：一级分母是 3,085，把 8 层的分母加起来却只有 2,031。
   * 界面上必须能解释这个差，否则学生（和验收的人）会以为某一层算错了。
   */
  unlayeredLeafCount: z.number().int().min(0),
});

export type KnowledgePointProgress = z.infer<typeof KnowledgePointProgressSchema>;
export type LayerProgress = z.infer<typeof LayerProgressSchema>;
export type BookProgress = z.infer<typeof BookProgressSchema>;
export type ProgressBoard = z.infer<typeof ProgressBoardSchema>;
