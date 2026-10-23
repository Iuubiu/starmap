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
import {
  LevelItemSchema,
  LevelSpecSchema,
  // 别名：本文件下面也要导出一个叫 `LevelTemplateSchema` 的组件名（OpenAPI 的
  // component 名由它决定），两者同名会让「导入的」被「导出的」覆盖。
  LevelTemplateSchema as LevelTemplateSourceSchema,
} from '@starmap/shared';

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
  /**
   * 这次作答属于哪一轮复验（票 07）。
   *
   * ## 为什么归属由客户端认领而不是后端猜
   *
   * 复验的题目来自普通关卡（`pool='quiz'` 的判定题），作答走的也是普通的
   * `POST /attempts` —— 票 07 验收第 4 条要求「与普通作答共用同一套 BKT 更新
   * 路径」，所以不能为复验单开一个提交接口，否则那条路径迟早长成两套算法。
   *
   * 于是只剩「这次作答算不算某一回复验的」这一个信息缺口。用时间窗去猜是不行
   * 的：学习者可能同时开着普通关卡，时间窗会把别的作答算进复验；而且复验可以
   * 学到一半关掉页面，第二天再回来答剩下的题，时间窗根本圈不住。所以由提交方
   * 认领一个 `roundId`，服务端只校验这个会话存在且这道题真的在它的题单里。
   *
   * 认领错了（会话不存在 / 这题不在题单里 / 会话已判分）一律 422：那些情况
   * 都会让「这一轮考了哪几题」与「这一轮收到哪些作答」对不上，而判分正是靠
   * 这两个集合相等。
   */
  reviewRoundId: z.string().min(1).optional(),
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
  /**
   * 这条作答道属于哪一轮复验（票 07）。普通作答为 null。
   *
   * 随记录一起返回，前端才能回答「这一轮复验我已经答了几题」—— 不返回的话
   * 前端只能靠本地状态记，刷新就丢。
   */
  reviewRoundId: z.string().nullable(),
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

/**
 * 票 89：学习页右栏「本知识点进度」的一条门槛。
 *
 * `value` 是**本关**（这张关卡）的数字，且在服务端就已饱和到 `target`：
 * 「作答 474/8」那种分子把累计作答数喂进来的显示，问题不在 UI 而在数据源 ——
 * 一旦接口把累计数当分子发出去，任何客户端都会原样显示。这里把两件事分开：
 *
 * - `value`：算进本关判定的数，永远 ≤ `target`（进度条与文案用它）
 * - `cumulative`：本关真实累计（可能远超阈值，只给悬浮说明用）
 *
 * `target` 来自引擎（`MASTERY_MIN_ATTEMPTS` / `MASTERY_MIN_VARIANTS` / 档位的
 * `consecutiveCorrect`），`ratio` 也在服务端算好：前端不硬编码 8/3/2，也不做除法。
 */
export const KpGateProgressSchema = z.object({
  key: z.enum(['attempts', 'variants', 'streak']),
  label: z.string(),
  value: z.number().int().min(0),
  cumulative: z.number().int().min(0),
  target: z.number().int().min(1),
  ratio: z.number().min(0).max(1),
  reached: z.boolean(),
  unit: z.string(),
});

/** GET /api/v1/mastery/kp/:microKpId 的响应：本知识与本关的门槛进度。 */
export const KpProgressViewSchema = z.object({
  microKpId: z.string(),
  name: z.string(),
  /** 计入本关统计的关卡；没有关卡时为 null（数字退化成这个知识点自己的） */
  levelId: z.string().nullable(),
  levelTitle: z.string().nullable(),
  gates: z.array(KpGateProgressSchema),
  /** 本关出口门控最近一次判定是否已达标（没有判定历史时为 false） */
  gatePassed: z.boolean(),
  gateEvaluatedAt: z.string().nullable(),
  evaluatedAt: z.string(),
});

/** POST /api/v1/attempts 的响应：落库的那条记录 + 更新后的掌握度。 */
export const AttemptSubmitResponseSchema = z.object({
  attempt: AttemptRecordSchema,
  mastery: MasteryViewSchema,
});

// ---------------------------------------------------------------------------
// 票 06：出口门控与解锁
// ---------------------------------------------------------------------------

/** 门控三态判定：过 / 没过 / 还判不了（题量不够或此处本就不设门控） */
export const GateVerdictSchema = z.enum(['passed', 'failed', 'undetermined']);

/**
 * 门控不通过时该回去重看哪一块。
 *
 * 门控失败不能只回一句「不合格」—— 学习者需要知道**下一步做什么**。
 * 一个 `reteach` 指向本关里具体的 reteach 段（有段落 id 与标题，前端可以
 * 直接给一个跳回那段讲解的按钮）；`practice` 指向需要补练的知识点。
 */
export const GateRemediationSchema = z.object({
  kind: z.enum(['reteach', 'practice']),
  /** 回到本关的哪一段（`reteach` 时给）。段落一定是 spec 里真实存在的 id */
  stepId: z.string().nullable(),
  /** 那一段的标题，直接展示给学习者，免得前端再去 spec 里翻 */
  stepTitle: z.string().nullable(),
  /** 需要补练的知识点（`practice` 时给） */
  microKpId: z.string().nullable(),
  /** 一句话说明「缺的是哪一块」，完整中文句子，可直接渲染 */
  message: z.string(),
});

/**
 * 一次门控判定的结果，写进学习日志并可回看。
 *
 * ## 为什么把「用了哪几题」发出来
 *
 * 学习者问「为什么说我没过」时，答案必须是**可核对的具体题目**，不是
 * 一个黑箱分数。`itemIds` 是这次判定实际计入的题目，`wrongItemIds` 是其中
 * 答错的那些 —— 前端能直接把错题列出来，也能让作者自查门控是否抽到了
 * 不该抽的题。
 */
export const GateEvaluationSchema = z.object({
  levelId: z.string(),
  microKpId: z.string(),
  mode: z.enum(['none', 'exit', 'prereq']),
  verdict: GateVerdictSchema,
  reason: z.enum(['passed', 'below_threshold', 'insufficient_items', 'no_gate_configured']),
  passed: z.boolean(),
  /** 规则快照：判定当时的题量与达标线（数值改动后回看仍然看得懂） */
  rule: z.object({
    itemCount: z.number().int().min(1),
    passCount: z.number().int().min(1),
  }),
  /** 这次实际计入门控的作答数（按题去重后） */
  correct: z.number().int().min(0),
  total: z.number().int().min(0),
  /** 还差几题到达标线。已通过时为 0 */
  shortfall: z.number().int().min(0),
  /** 引擎生成的中文判定说明，可直接展示 */
  message: z.string(),
  /** 这次判定用的题目（按题干顺序），可回看 */
  itemIds: z.array(z.string()),
  /** 其中答错的题目 */
  wrongItemIds: z.array(z.string()),
  /** 判定时刻（ISO 字符串） */
  evaluatedAt: z.string(),
  /** 未通过时的重讲路径；通过时为 null */
  remediation: GateRemediationSchema.nullable(),
});

/**
 * 一个节点当前的解锁状态。
 *
 * `unlocked=false` 时不只要说「没解锁」，还要说**被哪几道门挡着、各差多少** ——
 * 这就是 `blockers`。前端据此渲染「先学完《XX》并通过它的出口测试（还差 2 题）」。
 */
export const UnlockStateSchema = z.object({
  microKpId: z.string(),
  unlocked: z.boolean(),
  /**
   * 挡住这个节点的先修门。空数组 = 没有任何门控挡路。
   * 注意「没被任何门控挡住」不等于「学过了」，只表示从这里进得去。
   */
  blockers: z.array(
    z.object({
      /** 挡路的先修知识点 */
      prerequisiteId: z.string(),
      prerequisiteName: z.string(),
      /** 那道门挂在哪张关卡上（关卡被删则为 null） */
      levelId: z.string().nullable(),
      levelTitle: z.string().nullable(),
      gateMode: z.enum(['exit', 'prereq']),
      /** 最近一次判定的结果；从没判过时为 null */
      lastVerdict: GateVerdictSchema.nullable(),
      /** 最近一次判定还差几题；从没判过时为 null */
      shortfall: z.number().int().min(0).nullable(),
      /** 最近一次判定用了哪几题（可回看） */
      lastAttemptedItemIds: z.array(z.string()),
    }),
  ),
});

/**
 * 门控判定 + 本次解锁结果的响应体。
 *
 * 判定的副作用（写学习日志、写 node_unlocks）与判定本身在**同一个事务**里：
 * 「过了但没解锁」会让学习者反复重考，而「解锁了但日志没记」会让回看断链。
 */
export const GateResponseSchema = z.object({
  evaluation: GateEvaluationSchema,
  /** 本次新解锁的下游知识点。已解锁过的不重复列出 */
  unlockedNodeIds: z.array(z.string()),
});

/**
 * 一个关卡的门控判定历史（新的在前）。
 *
 * ## 为什么要专门一个读接口
 *
 * 「门控结果写进学习日志，可回看每次判定用了哪几题」不能只靠“日志表里有数据”：
 * 回看必须是一个**能调用的、有形状的**能力，否则学习者只能被告知“已在后台记录”。
 * 这个接口把 `learning_log` 里的 gate_* 事件读回成 `GateEvaluation`，与当时
 * POST 拿到的结构一样 —— 前端用同一个组件渲染历史与当下。
 */
export const GateHistoryResponseSchema = z.object({
  levelId: z.string(),
  evaluations: z.array(GateEvaluationSchema),
});

export type GateHistoryResponse = z.infer<typeof GateHistoryResponseSchema>;

export type GateVerdict = z.infer<typeof GateVerdictSchema>;
export type GateRemediation = z.infer<typeof GateRemediationSchema>;
export type GateEvaluation = z.infer<typeof GateEvaluationSchema>;
export type UnlockState = z.infer<typeof UnlockStateSchema>;
export type GateResponse = z.infer<typeof GateResponseSchema>;

export type AttemptSubmitRequest = z.infer<typeof AttemptSubmitRequestSchema>;
export type AttemptRecord = z.infer<typeof AttemptRecordSchema>;
export type MasteryView = z.infer<typeof MasteryViewSchema>;
export type KpGateProgress = z.infer<typeof KpGateProgressSchema>;
export type KpProgressView = z.infer<typeof KpProgressViewSchema>;
export type AttemptSubmitResponse = z.infer<typeof AttemptSubmitResponseSchema>;

// ---------------------------------------------------------------------------
// 票 07：掌握度复验与间隔排期
// ---------------------------------------------------------------------------

/**
 * 复验队列里的一项：一个到期（或已逾期）的已掌握知识点。
 *
 * `overdueDays` 是**派生**值而不是存下来的：它随时间连续变化，存下来必然变旧。
 * 存的是 `nextDueAt`，逾期多少天由 `now - nextDueAt` 现算。
 */
export const ReviewQueueEntrySchema = z.object({
  microKpId: z.string(),
  name: z.string(),
  /** 到期时刻（`mastery.next_review_at` 原值）。与图谱 `reviewDueAt` 是同一列 */
  nextDueAt: z.string(),
  /** 逾期天数，向下取整；未逾期为 0 */
  overdueDays: z.number().int().min(0),
  /** 复验间隔序列上的位置（0..4 对应 1/3/7/21/60 天） */
  reviewStage: z.number().int().min(0).max(4),
  /**
   * 这个档位对应的间隔天数。
   *
   * 序列的唯一真源是 `packages/engine/src/review.ts` 的 `REVIEW_INTERVALS_DAYS`；
   * 前端不重复写一份（`apps/web` 不依赖 engine，抄一份必然漂移）。
   */
  intervalDays: z.number().int().min(1),
  /**
   * 这个知识点现在能抽多少道复验题。
   *
   * 少于 3 道时这个知识点抽不出一份合规的题单 —— `POST /review/rounds` 会
   * 返 409（「每次 3–5 题」是验收要求，不是建议值）。
   */
  availableItemCount: z.number().int().min(0),
});

/**
 * 复验队列。
 *
 * 空数组是**正常状态**而不是错误：没到期的日子不该有复验。前端据此决定
 * 是否给「开始复验」的入口，所以这里不需要 404。
 */
export const ReviewQueueResponseSchema = z.object({
  due: z.array(ReviewQueueEntrySchema),
});

/**
 * 复验里的一道题。
 *
 * 与 `LevelSpec` 的 `items` 不同，这里**带题干与选项的正文**（`stem`/`options`
 * 都在），因为复验会话是后端的题单，前端没有对应的关卡 spec 可以查。
 *
 * `answer` 字段**不存在** —— 与 `AttemptSubmitRequest` 不带 correct 是同一条
 * 理由：判对错在服务端。`explainCorrect` / `explainWrong` 则是预写反馈
 * （票 04 的约定），答完立刻显示，不需要等任何模型。
 */
export const ReviewQuestionSchema = z.object({
  /** 交错后的呈现顺序，从 1 开始 */
  ordinal: z.number().int().min(1),
  itemId: z.string(),
  microKpId: z.string(),
  microKpName: z.string(),
  variantGroup: z.string(),
  stem: z.string(),
  options: z.array(z.string()),
  explainCorrect: z.string(),
  explainWrong: z.string(),
  misconceptionTags: z.array(z.string()),
});

/** 一次复验会话。 */
export const ReviewRoundSchema = z.object({
  roundId: z.string(),
  itemCount: z.number().int().min(0),
  createdAt: z.string(),
  /** 判分之前为 null */
  completedAt: z.string().nullable(),
  /** 判分之前为 null；多个知识点时，全部通过才算这轮通过 */
  verdict: z.enum(['passed', 'failed']).nullable(),
  correctCount: z.number().int().min(0).nullable(),
});

/** 开始复验：会话 + 交错后的题单。 */
export const ReviewRoundStartResponseSchema = z.object({
  round: ReviewRoundSchema,
  items: z.array(ReviewQuestionSchema),
  /** 这一轮覆盖的已到期知识点（按到期先后）。题单是从它们的池子里交错抽的 */
  microKpIds: z.array(z.string()),
});

/**
 * 一个知识点在这一回复验里的判定结果。
 *
 * ## 为什么按知识点分开判
 *
 * 一次复验覆盖多个知识点（票 07 验收第 1 条要求交错），但间隔排期是
 * **每个知识点各自一条**。A 记得牢、B 忘了，不能让 B 的遗忘把 A 的间隔
 * 一起退回去 —— 那会让一个薄弱点永久拖住整片复习计划。
 *
 * `correct` / `total` 只数这个知识点的题，所以 `message` 里的「答对 1 / 2」
 * 与学习者看到的那几道题对得上。
 */
export const ReviewOutcomeSchema = z.object({
  microKpId: z.string(),
  name: z.string(),
  correct: z.number().int().min(0),
  total: z.number().int().min(0),
  passed: z.boolean(),
  verdict: z.enum(['passed', 'failed']),
  /** 推进后的间隔档位（通过 +1、未通过 −1，夹在 0..4） */
  stage: z.number().int().min(0).max(4),
  /** 推进后的下次到期时刻 */
  nextDueAt: z.string(),
  correctItemIds: z.array(z.string()),
  wrongItemIds: z.array(z.string()),
  /** 一句话中文说明，可直接渲染 */
  message: z.string(),
});

/**
 * 判分结果。
 *
 * `mastery` 是判分后各知识点的掌握度（与 `GET /mastery/:id` 同一个形状）：
 * 复验的落点就是「current 降了、achieved 没降」，把这个事实随响应一起给出，
 * 前端不必再发 N 个请求去拼。
 */
export const ReviewCompleteResponseSchema = z.object({
  round: ReviewRoundSchema,
  outcomes: z.array(ReviewOutcomeSchema),
  mastery: z.array(MasteryViewSchema),
});

/** 重新读一次已判分的会话（刷新页面后回到同一份结果）。 */
export const ReviewRoundDetailResponseSchema = z.object({
  round: ReviewRoundSchema,
  outcomes: z.array(ReviewOutcomeSchema),
  items: z.array(ReviewQuestionSchema),
  mastery: z.array(MasteryViewSchema),
});

export type ReviewQueueEntry = z.infer<typeof ReviewQueueEntrySchema>;
export type ReviewQueueResponse = z.infer<typeof ReviewQueueResponseSchema>;
export type ReviewQuestion = z.infer<typeof ReviewQuestionSchema>;
export type ReviewRound = z.infer<typeof ReviewRoundSchema>;
export type ReviewRoundStartResponse = z.infer<typeof ReviewRoundStartResponseSchema>;
export type ReviewOutcome = z.infer<typeof ReviewOutcomeSchema>;
export type ReviewCompleteResponse = z.infer<typeof ReviewCompleteResponseSchema>;
export type ReviewRoundDetailResponse = z.infer<typeof ReviewRoundDetailResponseSchema>;

// ---------------------------------------------------------------------------
// 票 66：关卡模板与导入导出
// ---------------------------------------------------------------------------

/**
 * 模板的形状直接引用 `@starmap/shared`。
 *
 * 与 `LevelSpec` 同理：模板的真源在 shared（`fillLevelTemplate()` 要在纯函数
 * 环境里跑，还要被校验器约束），契约层只负责把**同一个**形状暴露给前端。
 * 抄一份的后果是「后端填模板用一套规则、前端画槽位用另一套」。
 */
export const LevelTemplateSchema = LevelTemplateSourceSchema;
export type LevelTemplateView = z.infer<typeof LevelTemplateSchema>;

/**
 * 模板列表。
 *
 * 用对象包一层 `templates` 而不是裸数组：裸数组的响应没有地方加「以后可能要
 * 有的分页/版本信息」，而改成对象是一次破坏性变更。这条经验来自 `review/queue`
 * ——它当初也是裸数组，后来只能靠加字段绕过。
 */
export const LevelTemplateListResponseSchema = z.object({
  templates: z.array(LevelTemplateSchema),
});

export type LevelTemplateListResponse = z.infer<typeof LevelTemplateListResponseSchema>;

/**
 * 预览请求：模板 × 学习者状态 → 草稿。
 *
 * `tier` 可省（缺省 P1），但**显式传**是本接口的主要用途：同一模板在三档下
 * 填出的 `steps` 段数不同（P1 七段 / P2 六段 / P3 五段），前端要能对比。
 * `microKpId` 必填：草稿的 `meta.microKpId` 与所有 id 都从它派生。
 */
export const LevelTemplatePreviewRequestSchema = z.object({
  microKpId: z.string().min(1),
  tier: z.enum(['P1', 'P2', 'P3']).optional(),
  /** 知识点名。给了就用它写进占位正文，没给由服务端查库 */
  microKpName: z.string().min(1).optional(),
});

export type LevelTemplatePreviewRequest = z.infer<typeof LevelTemplatePreviewRequestSchema>;

/**
 * 预览响应：一份**未持久化**的 `LevelSpec` 草稿。
 *
 * `persisted: false` 是字面量而不是 boolean：这个字段的作用是提醒调用方
 * 「你手里的东西还没进库」，写成可变的 boolean 会让人以为预览也能返回已存关卡。
 * 草稿本身能被 `validateLevelSpec` 通过（服务端在返回前跑过一遍），所以前端
 * 可以直接丢进播放器预览。
 */
export const LevelTemplatePreviewResponseSchema = z.object({
  persisted: z.literal(false),
  templateId: z.string(),
  tier: z.enum(['P1', 'P2', 'P3']),
  spec: LevelSpecSchema,
});

export type LevelTemplatePreviewResponse = z.infer<typeof LevelTemplatePreviewResponseSchema>;

/** 导出文件里的内容出处。`page` 认不出来就是 null —— 猜一个页码比没有更糟。 */
export const LevelExportSourceSchema = z.object({
  title: z.string(),
  page: z.number().int().min(0).nullable(),
});

export type LevelExportSource = z.infer<typeof LevelExportSourceSchema>;

/**
 * 导出文件（`starmap.level/1`）。
 *
 * `items` 与 `spec.items` 内容相同 —— 刻意的冗余，理由见
 * `apps/api/src/levels/levels.export.ts` 的文件头：嵌套结构对「不是 StarMap 的
 * 读者」不友好，摊平一份让文件能被人直接读懂。导入时校验两者一致，不一致说明
 * 文件被手改坏了，宁可拒绝也不猜。
 */
export const LevelExportFileSchema = z.object({
  format: z.literal('starmap.level/1'),
  exportedAt: z.string(),
  source: LevelExportSourceSchema,
  spec: LevelSpecSchema,
  items: z.array(LevelItemSchema),
});

export type LevelExportFileView = z.infer<typeof LevelExportFileSchema>;

/**
 * 导入请求 = 导出响应体本身。
 *
 * 直接复用 `LevelExportFileSchema` 而不是另立一个「导入格式」：两个形状一旦分开，
 * 「导出能过、导入不能过」就会成为一个只在用户手里发生的 bug。round-trip
 * 测试用同一份 schema 双向校验，形状漂移会立刻红。
 *
 * `format` 用 `z.literal` 锁死版本：未来格式不兼容时升到 `starmap.level/2`，
 * 老文件会被 422 拒绝并说清楚「这个版本我不认识」，而不是被半懂地读进来。
 */
export const LevelImportRequestSchema = LevelExportFileSchema;

export type LevelImportRequest = z.infer<typeof LevelImportRequestSchema>;

/**
 * 导入结果。
 *
 * `created` 区分「新建了一张」与「同一份内容已经在了，返回已有的那张」——
 * 前者是用户期待的，后者是幂等去重的结果，两者的提示语不同。`levelId` 两种
 * 情况都给出，前端可以直接跳过去。
 */
export const LevelImportResponseSchema = z.object({
  levelId: z.string(),
  created: z.boolean(),
  /** 内容指纹（sha256 前 12 位），同一份内容连导两次相同 */
  shareHash: z.string(),
  itemCount: z.number().int().min(0),
});

export type LevelImportResponse = z.infer<typeof LevelImportResponseSchema>;
