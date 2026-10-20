/**
 * 关卡领域契约：关卡摘要、关卡规范（level.spec.json）。
 *
 * 归属泳道：level-dev。领域文件由该泳道增改，`src/index.ts` 的 re-export 行
 * 已经预先写好，加 schema 不需要动共享文件。
 *
 * 关卡规范的真源在 `packages/shared/src/domain/level.ts`（校验器需要能在
 * 纯函数环境跑，契约包不是它的住所）。这里只放「对外形状」：列表/详情
 * 里出现的那一层摘要。
 */
import { z } from 'zod';
import { LevelSpecSchema } from '@starmap/shared';

export const LevelSummarySchema = z.object({
  levelId: z.string(),
  microKpId: z.string(),
  title: z.string(),
  itemCount: z.number().int().min(0),
  kind: z.enum(['teach', 'quiz', 'mixed']),
});

export type LevelSummary = z.infer<typeof LevelSummarySchema>;

/**
 * 关卡详情：摘要 + 完整 `level.spec`。
 *
 * `spec` 直接引用 `@starmap/shared` 的 `LevelSpecSchema`，**不在契约里另抄一份
 * 形状**。抄一份的后果是内容格式演进时两处各改各的，前端的播放器和后端的
 * 校验器会对同一份文件产生不同理解 —— 那正是票 04 要防的事。
 *
 * 代价是：改 spec 结构会连带改动 `openapi.yaml`（spec 的 JSON Schema 内联在
 * 这个组件里）。这是可接受的，因为 **API 确实把这个形状暴露给了前端**；
 * 隐藏它就等于让前端 `as any`。
 */
export const LevelDetailResponseSchema = z.object({
  level: LevelSummarySchema,
  spec: LevelSpecSchema,
});

export type LevelDetailResponse = z.infer<typeof LevelDetailResponseSchema>;

// ---------------------------------------------------------------------------
// 票 05：作答记录与双字段掌握度
// ---------------------------------------------------------------------------

/**
 * 掌握度五态。
 *
 * 取值域与 `domains/graph.ts` 的 `MasteryStateSchema` 逐字相同，但这里**刻意
 * 不复用那个导出**：`graph.ts` 已经 `import { LevelSummarySchema } from
 * './levels.js'`，反过来再引用会形成模块环（`.dependency-cruiser.cjs` 的
 * `no-circular` 会直接判违规，ESM 下也只是「碰巧能跑」）。
 *
 * 防漂移不靠自觉：测试断言本文件的取值域与 `graph.ts` 导出的那一份逐个相等，
 * 谁改了一边都会红。
 */
const MASTERY_STATES = ['mastered', 'proficient', 'familiar', 'attempted', 'unseen'] as const;

/**
 * 提交一次作答。
 *
 * 请求体只带「做了什么」，**不带「对不对」**：判对错由后端拿 `level_items.answer`
 * 比。客户端自报 correct 等于把掌握度交给浏览器算 —— 那是掌握度证据唯一
 * 不能让步的一环。
 *
 * 也不带 `levelId` / `microKpId` / `variantGroup` / `knowledgeKind`：这四个都能
 * 从 `itemId` 顺着 `level_items → levels` 查出来。让客户端传等于给它们增加了
 * 一份可漂移的副本，而且传错了会静默污染证据（例如把两个知识点的证据混到
 * 一个点上，BKT 会照算不误）。
 */
export const AttemptSubmitRequestSchema = z.object({
  itemId: z.string().min(1),
  /** 选择题是选项下标（数字），填空题是字符串。与 `LevelSpecItemsItem.answer` 同一取值域 */
  answer: z.union([z.number().int().min(0), z.string()]),
  /**
   * 这次作答发生在哪一段（`LevelStep.id`）。
   *
   * ## 为什么需要它
   *
   * 「深究与进一步讲解里的作答全程不扣掌握度」（spec 需求 17）需要后端知道
   * 这次作答属于哪一段。只看「这道题被哪些步骤引用」在题目被复用时是**有歧义
   * 的**：同一道题既出现在判定段又出现在深究段，靠题目反推分不出这次是哪一次。
   *
   * ## 为什么可选
   *
   * 不传时按「这道题只被补救段引用就不计分、被任何非补救段引用就计分」兜底，
   * 这对题目不复用的关卡是正确且更保守的（宁可少算，不可把深究段算成惩罚）。
   * 传了就必须是本关卡里引用了这道题的那一段，否则 422 —— 计分与否**只由步骤
   * 类型决定**，客户端无法通过谎报步骤来给深究段刷分。
   */
  stepId: z.string().min(1).optional(),
  /**
   * 作答用时（毫秒）。客户端计时。`null` 表示未记录（不是 0 毫秒）——
   * 两者在「想了 8 分钟才蒙对」这个信号上完全不同。
   */
  latencyMs: z.number().int().min(0).max(6 * 60 * 60 * 1000).nullable().optional(),
  /** 用了几级提示（0 = 裸答）。上限对齐 spec 的 hintLadder 最多 4 级 */
  hintsUsed: z.number().int().min(0).max(4).optional(),
});

/** 一条落库的作答记录。 */
export const AttemptRecordSchema = z.object({
  /**
   * bigserial 以字符串给出。
   *
   * JS 的 number 只能精确表示 2^53 以内的整数，而 `bigserial` 没有上限承诺；
   * 更实际的理由是：这串 id 只用于「回看第几条」，前端从不做算术，给字符串
   * 就不会有人在某天写下 `attemptId + 1`。
   */
  attemptId: z.string(),
  itemId: z.string(),
  /**
   * 这次作答发生在哪张关卡。可空：`attempts.level_id` 是
   * `ON DELETE SET NULL`，关卡被删掉以后证据仍在（掌握度不该因为作者删了
   * 一张练习关卡而缩水），这时归属就是「不知道」而不是空字符串。
   */
  levelId: z.string().nullable(),
  microKpId: z.string(),
  variantGroup: z.string(),
  correct: z.boolean(),
  /** 这道题的第几次作答（从 1 开始）。历史行（0011 迁移之前）为 0 */
  attemptNo: z.number().int().min(0),
  /** 是否计入掌握度。深究 / 进一步讲解段为 false */
  countsTowardMastery: z.boolean(),
  knowledgeKind: z.enum(['fact', 'concept', 'comprehensive']),
  createdAt: z.string(),
});

/**
 * 一个知识点的双字段掌握度。
 *
 * ## 为什么 `achieved` / `current` 在证据不足时是 `null` 而不是原始数字
 *
 * spec.md:259 要求「低于门槛 UI 显示『证据不足』不给数字」。如果接口把数字
 * 照发，就总有某个界面会把它格式化成 `62.4%` —— 一次界面失误的代价是让
 * 学习者看见一个**统计上毫无意义**的百分比，并据此决定要不要复习。所以
 * 「不给数字」这件事在接口层做死：`evidenceSufficient=false` 时两个字段
 * 都是 null，前端想显示也没得显示。
 *
 * 想知道「还差多少」请用 `attemptCount` / `variantCount` 与门槛常量比 ——
 * 那是事实，不是成绩。
 *
 * ## 非叶节点
 *
 * 掌握度只挂在叶节点上（ADR-0004）。非叶节点的这两个数是**只读派生**：
 * 叶子后代按证据量（作答次数）加权聚合，不落库、不参与解锁判定。`isLeaf`
 * 与 `aggregatedLeafCount` 让调用方能看出这一点，而不是把聚合值误当成
 * 「这个章节学会了 62%」。
 */
export const MasteryViewSchema = z.object({
  microKpId: z.string(),
  name: z.string(),
  isLeaf: z.boolean(),
  state: z.enum(MASTERY_STATES),
  /** 历史最高后验。不衰减，管解锁。证据不足时为 null */
  achieved: z.number().min(0).max(1).nullable(),
  /** 按半衰期衰减后的当前后验。管推荐与检索门控。证据不足时为 null */
  current: z.number().min(0).max(1).nullable(),
  attemptCount: z.number().int().min(0),
  /** 按 `variantGroup` 去重后的变式数（平行题不增加计数） */
  variantCount: z.number().int().min(0),
  evidenceSufficient: z.boolean(),
  /** 本次衰减采用的半衰期（天）：事实 14 / 概念 30 / 综合 45 */
  halfLifeDays: z.number().int().min(1),
  /** 最后一条证据的时刻。没有证据时为 null */
  lastEvidenceAt: z.string().nullable(),
  /** 聚合进来的叶子后代个数（含无证据的）；叶节点为 0 */
  aggregatedLeafCount: z.number().int().min(0),
});

/** POST /api/v1/attempts 的响应：落库的那条记录 + 更新后的掌握度。 */
export const AttemptSubmitResponseSchema = z.object({
  attempt: AttemptRecordSchema,
  mastery: MasteryViewSchema,
});

export type AttemptSubmitRequest = z.infer<typeof AttemptSubmitRequestSchema>;
export type AttemptRecord = z.infer<typeof AttemptRecordSchema>;
export type MasteryView = z.infer<typeof MasteryViewSchema>;
export type AttemptSubmitResponse = z.infer<typeof AttemptSubmitResponseSchema>;
