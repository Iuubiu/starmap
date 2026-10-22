/**
 * 定级领域契约：行为自评、定级题、定级会话与结果。
 *
 * 归属泳道：agent-dev（票 11 初始定级）。领域文件由本泳道增改，
 * `src/index.ts` 的 re-export 行请 integrator 加。
 *
 * ## 这一层为什么要有「会话」这个概念
 *
 * 定级是**一次有状态的问答**：第 9 题问哪一道取决于前 8 题的作答，停止条件
 * 也取决于累积的后验。如果把它做成「前端每次把全部历史 POST 回来」，服务端
 * 就成了无状态的似然计算器 —— 前端一旦刷新页面，学习者就得从第 1 题重来；
 * 而如果前端把历史存在 localStorage 里，那条历史又成了可以手改的输入。
 *
 * 所以定级会话落库（迁移 0016），每次作答只传 `itemId` + `answer`，服务端
 * 拿自己的历史推进。**这份历史与 `app.attempts` 物理隔离**：定级不是练习，
 * 它不产生掌握度记录（票 11 验收 6）。
 *
 * ## 为什么作答结果要回带正确答案与解析
 *
 * 票 11 验收 4 的原文：「定级结果必须展示答案与解析，让用户能判断系统有
 * 没有把自己判错」。如果只回一个「对了/错了」，学习者无法复核 —— 定级就
 * 变成了一个不可申诉的黑箱，而被判低的人会立刻不信任这个系统。
 */

import { z } from 'zod';

/** 三档水平。三档是**每关的渲染参数**，不是三条并列课程路径（spec D12）。 */
export const PlacementTierSchema = z.enum(['P1', 'P2', 'P3']);

export type PlacementTier = z.infer<typeof PlacementTierSchema>;

/** 定级题难度。与 engine 的 `PlacementDifficulty` 逐字对应。 */
export const PlacementDifficultySchema = z.enum(['easy', 'medium', 'hard']);

// ---------------------------------------------------------------------------
// 行为自评（4 题）
// ---------------------------------------------------------------------------

export const SelfAssessmentOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
});

export const SelfAssessmentQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  options: z.array(SelfAssessmentOptionSchema),
});

export type SelfAssessmentQuestionView = z.infer<typeof SelfAssessmentQuestionSchema>;

/**
 * 自评问卷。
 *
 * 只回问题，不回权重：权重（−1…+1）是评分模型的内部参数，暴露出去等于邀请
 * 前端自己算先验，而先验与档位的关系必须只有一处实现。
 */
export const SelfAssessmentFormResponseSchema = z.object({
  questions: z.array(SelfAssessmentQuestionSchema),
  /** 说明为什么要问这些 —— 写在契约里，前端不必自己编一段解释 */
  rationale: z.string(),
});

export type SelfAssessmentFormResponse = z.infer<typeof SelfAssessmentFormResponseSchema>;

export const SelfAssessmentAnswerSchema = z.object({
  questionId: z.string().min(1),
  optionId: z.string().min(1),
});

export const SelfAssessmentSubmitRequestSchema = z.object({
  answers: z.array(SelfAssessmentAnswerSchema).min(1),
});

export type SelfAssessmentSubmitRequest = z.infer<typeof SelfAssessmentSubmitRequestSchema>;

/**
 * 自评提交后的回执。
 *
 * `priorShift` 是这次自评把起手先验平移了多少 logit（**最多 ±0.4**）。
 * 返回它是为了让页面能说「你的回答让我们把起点略微上/下挪了一点」——
 * 而不是「你被定为 P3 了」。自评不直接定档，这个字段就是那句话的证据。
 */
export const SelfAssessmentSubmitResponseSchema = z.object({
  priorShift: z.number(),
  /** 三个档位的先验概率，顺序 P1/P2/P3，和为 1 */
  priorProbabilities: z.array(z.number()).length(3),
});

export type SelfAssessmentSubmitResponse = z.infer<typeof SelfAssessmentSubmitResponseSchema>;

// ---------------------------------------------------------------------------
// 定级题
// ---------------------------------------------------------------------------

/**
 * 一道定级题。
 *
 * **不回 `answer`**：定级过程中把正确答案发给前端，等于让学生开卷。
 * 答案与解析在作答之后由 `PlacementAnswerResponseSchema` 回带。
 */
export const PlacementItemViewSchema = z.object({
  itemId: z.string(),
  microKpId: z.string(),
  /** 知识点名称，用于「这道题考的是……」 */
  microKpName: z.string(),
  stem: z.string(),
  options: z.array(z.string()),
  difficulty: PlacementDifficultySchema,
});

export type PlacementItemView = z.infer<typeof PlacementItemViewSchema>;

export const PlacementStartRequestSchema = z.object({
  /** 4 题自评的作答。**必须**先做自评：起手难度由它决定 */
  selfAssessment: z.array(SelfAssessmentAnswerSchema).min(1),
});

export type PlacementStartRequest = z.infer<typeof PlacementStartRequestSchema>;

/**
 * 定级会话。
 *
 * `item` 为 null 表示**本次定级已经结束**（`stop.reason` 会说明原因）：
 * 题池用尽、或已达 18 题上限。前端看到 `item === null` 就该调到结果页。
 */
export const PlacementSessionResponseSchema = z.object({
  sessionId: z.string(),
  /** 第一道题。会话刚建时一定非空（除非题池一开始就是空的） */
  item: PlacementItemViewSchema.nullable(),
  answered: z.number().int().min(0),
  /** 已答对的题数。用于「你答对了 6/10」这类进度显示 */
  correctCount: z.number().int().min(0),
  /** 三个档位的当前后验，顺序 P1/P2/P3 */
  probabilities: z.array(z.number()).length(3),
  /** 当前后验标准差。前端可显示「还不太确定」 */
  posteriorSd: z.number(),
  /** 停止条件是否已满足。`item === null` 时这里必然是 stopped */
  stop: z.object({
    stopped: z.boolean(),
    reason: z
      .enum(['sd', 'band', 'entropy', 'max_items', 'no_more_items'])
      .nullable(),
  }),
  /** 题池里还剩几道没问过。低于 3 时页面要提示「题不多了」 */
  remainingItems: z.number().int().min(0),
});

export type PlacementSessionResponse = z.infer<typeof PlacementSessionResponseSchema>;

export const PlacementAnswerRequestSchema = z.object({
  itemId: z.string().min(1),
  /**
   * 选择题是选项下标（整数），填空题是字符串 —— 与 `AttemptSubmitRequest.answer`
   * 同一套约定，判分也走同一个 `judgeAnswer`。
   */
  answer: z.union([z.number().int().min(0), z.string()]),
});

export type PlacementAnswerRequest = z.infer<typeof PlacementAnswerRequestSchema>;

/**
 * 一次定级作答的判定与解释。
 *
 * `explanation` 至少包含正确答案 + 预写的 `explainCorrect`；判错时还要带
 * `explainWrong`。这是票 11 验收 4 的落点：**定级必须能被学习者复核**。
 */
export const PlacementAnswerResponseSchema = z.object({
  itemId: z.string(),
  correct: z.boolean(),
  /** 正确答案。选择题是下标，填空题是字符串 */
  correctAnswer: z.union([z.number().int().min(0), z.string()]),
  /** 正确答案的可读形式（选择题渲染成选项文本），直接展示不用前端再拼 */
  correctAnswerText: z.string(),
  /** 预写的正确解析。内容里缺失时为 null（不编造） */
  explanation: z.string().nullable(),
  /** 预写的错误解析（判错时才回）。内容里缺失时为 null */
  whyWrong: z.string().nullable(),
  /** 判定之后的下一个状态，形状与 `PlacementSessionResponse` 相同 */
  session: PlacementSessionResponseSchema,
});

export type PlacementAnswerResponse = z.infer<typeof PlacementAnswerResponseSchema>;

// ---------------------------------------------------------------------------
// 定级结果
// ---------------------------------------------------------------------------

/** 定级结果里逐题的复核行。让学习者能看到「你答了哪些题、各对错」 */
export const PlacementReviewItemSchema = z.object({
  itemId: z.string(),
  microKpId: z.string(),
  stem: z.string(),
  yourAnswerText: z.string(),
  correctAnswerText: z.string(),
  correct: z.boolean(),
  difficulty: PlacementDifficultySchema,
});

export type PlacementReviewItem = z.infer<typeof PlacementReviewItemSchema>;

/**
 * 定级结果。
 *
 * `status` 永远是 `provisional`（票 11 验收 5：允许日后重判）。前端必须
 * 把这个词显示出来 —— 一个看起来像终审的定级会让被判低的人放弃。
 *
 * `lowConfidence` 为 true 时页面要显式说「这个结果还不太准，多学几个知识点
 * 后会自动重判」。它对应的情形是：题池不够 8 题、或后验最大概率不到 0.5。
 */
export const PlacementResultResponseSchema = z.object({
  sessionId: z.string(),
  tier: PlacementTierSchema,
  status: z.literal('provisional'),
  confidence: z.number().min(0).max(1),
  lowConfidence: z.boolean(),
  probabilities: z.array(z.number()).length(3),
  answered: z.number().int().min(0),
  correctCount: z.number().int().min(0),
  stopReason: z
    .enum(['sd', 'band', 'entropy', 'max_items', 'no_more_items'])
    .nullable(),
  /** 逐题复核表。**必须非空**（除非一道题都没答） */
  review: z.array(PlacementReviewItemSchema),
  /**
   * 累计答多少题后自动重判。回给前端是为了让结果页能写具体数字，
   * 而不是硬编码一句「以后会自动重判」。
   *
   * 计数口径是「题」不是「知识点」：spec.md:52 与 spec.md:283 都写的是
   * 「学 5 题后可重判」。用知识点计数会让重判在最初几天永远不触发 ——
   * `evidenceSufficient` 要求 8 题 + 3 变式，新人做完 5 题时一个知识点
   * 都还没「学完」，而那恰是定级最容易判错、最需要纠正的时候。
   */
  rejudgeAfterAttempts: z.number().int().min(1),
  /** 说明为什么是这个档位 —— 中文，由后端拼好（它要引用具体数字） */
  explanation: z.string(),
});

export type PlacementResultResponse = z.infer<typeof PlacementResultResponseSchema>;

// ---------------------------------------------------------------------------
// 定级的读取与重判
// ---------------------------------------------------------------------------

/**
 * 一次重判的记录。
 *
 * 与 `PlacementRejudgeResponse` 的区别：那个是**这次请求**的结果（含
 * `placedAt` 之类的请求时刻），这个是**历史条目**，用于在状态里回答
 * 「我的档位为什么变了」。两者内容重叠但不是同一个东西 —— 合并会让
 * 「重判历史」跟着响应字段一起漂移。
 */
export const PlacementRejudgeEventSchema = z.object({
  previousTier: PlacementTierSchema,
  tier: PlacementTierSchema,
  changed: z.boolean(),
  /** 触发这次重判时「自上次定级/重判以来累计的作答数」 */
  attemptsSince: z.number().int().min(0),
  /** 首轮正确率；没有可算的样本时为 null（不是 0） */
  averageFirstTryRate: z.number().min(0).max(1).nullable(),
  explanation: z.string(),
  /** 这次重判发生的时刻 */
  at: z.string(),
});

export type PlacementRejudgeEvent = z.infer<typeof PlacementRejudgeEventSchema>;

/**
 * 当前学习者的定级状态（不含作答细节）。
 *
 * `GET /api/v1/placement` 用它回答「我定过级吗、现在是什么档」。**没有定级
 * 记录时返回 `tier: null`**，不是 404 —— 新用户没定过级是正常状态，不是错误。
 */
export const PlacementStatusResponseSchema = z.object({
  tier: PlacementTierSchema.nullable(),
  /**
   * 只有两种值：没定过级（`none`）、定过级（`provisional`）。
   *
   * **没有 `confirmed`**：全仓没有任何写入路径能把它写进库里
   * （`upsertProfile` 写 `provisional`、`applyRejudge` 不碰 status 列），
   * 它是一个从入口就不可达的死枚举值。spec.md:283 与票 11 验收 5 的语义
   * 本来就是「定级结果永远是临时的、随时会被学习证据修正」，不存在
   * 「确认后不再改」这个终态 —— 硬造出来只会得到「已确认但系统还能改」
   * 的矛盾状态。
   */
  status: z.enum(['none', 'provisional']),
  /** 定级或上次重判的时刻。`status === 'none'` 时为 null */
  placedAt: z.string().nullable(),
  /** 累计答几题后自动重判（spec: 学 5 题） */
  rejudgeAfterAttempts: z.number().int().min(1),
  /** 自上次定级/重判以来累计的作答数 */
  attemptsSince: z.number().int().min(0),
  /**
   * 此刻是否该重判（`status === 'provisional'` 且学分够了）。
   *
   * 只在**并发**下才会读到 true：读取状态本身会执行自动重判，正常请求
   * 返回时它已经是 false。留着它是为了让「刚好两个请求同时到」的客户端
   * 知道该重读一次，而不是看着一个不变的档位发呆。
   */
  shouldRejudge: z.boolean(),
  /**
   * 最近一次重判（自动或手动），没有则为 null。
   *
   * 这个字段存在的理由：自动重判发生在**读状态**的时候，学习者没有点任何
   * 按钮，档位却变了。不解释一句「系统根据你的学习数据把档位从 P1 调到
   * P2」，这件事看起来就是应用出错了。
   */
  lastRejudge: PlacementRejudgeEventSchema.nullable(),
});

export type PlacementStatusResponse = z.infer<typeof PlacementStatusResponseSchema>;

/**
 * 触发重判。
 *
 * 不需要请求体：重判用的是**已有的学习证据**（真实作答），而不是重新答一遍
 * 定级题。这是票面「学满 3 个知识点后自动重判」的字面含义 —— 系统用真实
 * 学习数据修正最初那 8–18 题的判断（门槛口径见 `rejudgeAfterAttempts`）。
 */
export const PlacementRejudgeResponseSchema = z.object({
  tier: PlacementTierSchema,
  /** 重判前后的档位。相同表示这次没有升降级 */
  previousTier: PlacementTierSchema,
  changed: z.boolean(),
  /**
   * 重判依据：自上次定级/重判以来的作答数与首轮正确率
   *
   * `attemptsSince` 是**触发门槛的那个数**（≥ `rejudgeAfterAttempts`）；
   * `averageFirstTryRate` 是决定升降的判据 —— 两者是不同的问题：「够不够
   * 格重判」与「重判后往哪走」。
   */
  attemptsSince: z.number().int().min(0),
  averageFirstTryRate: z.number().min(0).max(1).nullable(),
  /** 中文说明，引用具体数字 */
  explanation: z.string(),
  placedAt: z.string(),
});

export type PlacementRejudgeResponse = z.infer<typeof PlacementRejudgeResponseSchema>;
