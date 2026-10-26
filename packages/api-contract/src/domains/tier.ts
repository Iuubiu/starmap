/**
 * 三档渲染参数（票 12）的对外形状。
 *
 * 归属泳道：agent-dev。
 *
 * ## 为什么参数要过一趟 HTTP，而不是 web 直接 import engine
 *
 * 真源是 `packages/engine/src/tier.ts` 的 `TIER_PARAMS`——纯函数包、可穷举测试。
 * 但 `apps/web` 的依赖里**没有** `@starmap/engine`（`.dependency-cruiser.cjs` 之外
 * 还有一条更实际的理由：engine 的 `dist` 是构建产物，让 web 单测依赖「先 build
 * engine」会引入一个只在 CI 偶发失败的时序问题）。所以 web 通过这一层拿服务端算好
 * 的投影：**单一真源仍然是 engine，web 里禁止再写一份硬编码表。**
 *
 * ## 为什么值域全是字符串枚举而不是数字
 *
 * 参数会出现在界面上（「你的档位：补全步骤」）。数字枚举在契约里无法表达
 * 「P1 的阶梯上限是 3」这类业务含义，而字符串枚举在 OpenAPI 里能被 Orval 直接
 * 生成联合类型，前端写 `case 'item_deferred_with_summary'` 时拼错会编译失败。
 */
import { z } from 'zod';

/**
 * 档位投影。与 `PlacementTierSchema` 的取值域逐字相同，但**刻意不复用那个导出**：
 * `placement.ts` 已经引了 `tier.ts` 要用不到的一堆东西，反向引用只会让模块图变复杂。
 * 防漂移靠测试（`tier.contract.test.ts` 断言两份取值域逐个相等），不靠 import。
 */
export const TierNameSchema = z.enum(['P1', 'P2', 'P3']);

export type TierName = z.infer<typeof TierNameSchema>;

/** 关卡首轮形态。取值域与 engine 的 `FirstRoundShape` 逐字相同。 */
export const FirstRoundShapeSchema = z.enum(['worked_example', 'completion', 'direct']);

export type FirstRoundShape = z.infer<typeof FirstRoundShapeSchema>;

/** 反馈延迟。取值域与 engine 的 `FeedbackTiming` 逐字相同。 */
export const FeedbackTimingSchema = z.enum([
  'step_immediate',
  'step_immediate_with_summary',
  'item_deferred_with_summary',
]);

export type FeedbackTiming = z.infer<typeof FeedbackTimingSchema>;

/**
 * 追问阶梯的起始与上限。
 *
 * `cap` 就是票面第二维「阶梯层数（3/4/5）」——它是**上限**而不是固定层数：
 * 一个 P3 学习者也可能从第 1 级开始（答错了就往上走），上限决定的是「最多能
 * 帮到什么程度」。
 */
export const TierLadderSchema = z.object({
  start: z.number().int().min(1).max(5),
  cap: z.number().int().min(1).max(5),
});

export type TierLadder = z.infer<typeof TierLadderSchema>;

/** 掌握判定条件。三档都要求迁移题，只有连对次数不同（spec §5 第六行）。 */
export const TierMasteryRuleSchema = z.object({
  consecutiveCorrect: z.number().int().min(1),
  requiresTransferItem: z.boolean(),
});

export type TierMasteryRule = z.infer<typeof TierMasteryRuleSchema>;

/**
 * 六维参数。字段顺序与 spec 表格一致，便于逐行对照。
 *
 * 只要 web 需要读某个维度，它就**必须**出现在这里——不能「先只传三个字段，
 * 剩下的前端猜」。少传一个字段的后果是前端会去写一份近似值，那份近似值
 * 与 engine 的差值不会有任何测试能发现。
 */
export const TierParamsSchema = z.object({
  tier: TierNameSchema,
  /** ① 关卡首轮形态 */
  firstRoundShape: FirstRoundShapeSchema,
  /** ② 追问阶梯起始与上限 */
  ladder: TierLadderSchema,
  /** ③ 单次会话可引入的新知识点上限 */
  sessionNewKpLimit: z.number().int().min(1),
  /** ④ 反馈延迟 */
  feedbackTiming: FeedbackTimingSchema,
  /** ⑤ 每题尝试次数 */
  attemptsPerItem: z.number().int().min(1),
  /** ⑥ 掌握判定 */
  masteryRule: TierMasteryRuleSchema,
});

export type TierParams = z.infer<typeof TierParamsSchema>;

/**
 * 当前档位与参数。
 *
 * `tier` 永远是**实际生效**的档位，从不为 null：没定过级时它是 P1（默认档）。
 * 「要不要说『你还没定级』」由 `source` 回答，不由 `tier` 为 null 回答。
 *
 * ## 为什么不留一个 `tier: null` 的三态
 *
 * 第一版写的是 `tier: TierName.nullable()`，含义是「null = 没定级」。下游每个
 * 消费方都得先判空才能拿参数，而参数本身又只能回落到 P1 —— 于是「null 该按哪档
 * 渲染」这个问题在三个页面里各答一遍。`source` 已经精确表达了同一件事（这个档位
 * 是定级来的还是回落的），两个字段说同一件事就够，不需要第二个空值分支。
 */
export const TierOverviewResponseSchema = z.object({
  /** 实际生效的档位（没有定级记录时为 P1，看 `source` 区分） */
  tier: TierNameSchema,
  /**
   * `placement`：库里真有定级记录；`fallback`：没有记录，参数是 P1 的。
   *
   * 两个值而不是一个 boolean，是为了让「没有定级」与「定级到 P1」不共用一条
   * 分支——它们对学习者显示的话不一样（一个是「先按默认档」，一个是「你是 P1」）。
   */
  source: z.enum(['placement', 'fallback']),
  params: TierParamsSchema,
  /** 档位展示名（「完整样例」「补全步骤」「直接出题」） */
  label: z.string(),
  /** 首轮形态的一句话说明，直接给学习者看 */
  description: z.string(),
  /**
   * 判定依据句（票 06），服务端拼好的中文，形状对齐 mockup：
   * `由 3 次作答判定 · 2 个变式已覆盖 · 连对 1/2`。
   *
   * 先例是 `NodeSourceSchema.pageLabel`（graph.ts）：**句子给人，字段给机器**。
   * 「·」分隔、量词、连对写成 x/y——都是文案，只允许服务端拼一处；数值
   * 同时用下面三个 `basis*` 字段给出，前端要加粗数字或做进度条时读字段，
   * 不要正则抠句子。
   *
   * `source = 'fallback'`（没定过级）时它是引导句（如「定级后这里会写判定
   * 依据」）而不是拼 0 的数字句——0/0/0 此刻没有证据可回放，说出口就是编的。
   */
  basis: z.string(),
  /**
   * 依据窗内的作答数：自上次定级/重评以来累计、计入掌握度的作答数
   * （`counts_toward_mastery = true`）。三个 basis 数字描述**同一个证据窗**
   * ——那正是下一次重判会看的作答。fallback 时为 0。
   */
  basisAttempts: z.number().int().min(0),
  /** 依据窗内覆盖到的变式组数（`attempts.variant_group` 去重）。fallback 时为 0。 */
  basisVariants: z.number().int().min(0),
  /**
   * 依据窗内从最新一次作答往前数的连续答对次数。分母**不在契约里**：
   * 它就是 `params.masteryRule.consecutiveCorrect`，句子里的「/2」由服务端
   * 从同一份参数拼出来，前端不需要也不应该自己再算一遍。fallback 时为 0。
   */
  basisStreak: z.number().int().min(0),
});

export type TierOverviewResponse = z.infer<typeof TierOverviewResponseSchema>;

/**
 * 首轮计划：界面据此决定从哪一段开始、卡片怎么摊。
 *
 * 它**不能**在前端由 `firstRoundShape` 推导出来：`direct` 需要往 spec 里找
 * 「第一段带题的段」，`completion` 需要找「第一段带卡的段的最后一张卡」，
 * `fadedCardId` 是 spec 里真实的卡片 id。前端自己算就要把同一套规则写第二遍。
 */
export const FirstRoundPlanSchema = z.object({
  shape: FirstRoundShapeSchema,
  /** 从第几段开始（0 基）。`direct` 会跳过前面所有纯讲解段 */
  startStepIndex: z.number().int().min(0),
  /**
   * 卡片呈现方式。
   * - `all`：全部展开
   * - `faded`：第一段最后一张卡只给标题（forward fading）
   * - `none`：默认收起，可按需展开
   */
  cardMode: z.enum(['all', 'faded', 'none']),
  /** `faded` 时要藏起正文的那张卡；其余形态为 null */
  fadedCardId: z.string().nullable(),
});

export type FirstRoundPlan = z.infer<typeof FirstRoundPlanSchema>;

/**
 * 按本档判定条件算出的「还差什么」。
 *
 * 由**服务端**从 `app.attempts` 回放算，不是前端拿本地 `flow.records` 数一遍。
 * 理由是两边答的不是同一个问题：本地记录只覆盖「这一次打开页面之后」的作答，
 * 而掌握判定针对的是这个知识点的全部证据（跨关卡、跨会话）。用本地记录算，
 * 学习者刷新一次页面就会看到「还差 2 次连续答对」从头开始。
 */
export const TierMasteryProgressSchema = z.object({
  /** 从最后一条往前数，连续答对了几次 */
  consecutiveCorrect: z.number().int().min(0),
  /** 是否已经出现过迁移题（`knowledge_kind = 'comprehensive'`）的作答 */
  hasTransferItem: z.boolean(),
  /** 按这一档的规则，当前是否满足 */
  satisfied: z.boolean(),
  /** 还差什么（中文，直接给学习者看）；已满足时为空数组 */
  missing: z.array(z.string()),
});

export type TierMasteryProgress = z.infer<typeof TierMasteryProgressSchema>;

/**
 * 单关的档位计划。
 *
 * 一个请求同时拿回参数与首轮计划：「我这一档怎么渲染这一关」是一个问题，
 * 拆成两个请求就会出现「参数是按 P2 算的、计划是按 P1 算的」那一帧。
 *
 * `masteryProgress` 也在这里，而不是单独一个端点：它读的是**同一个知识点**
 * 的证据，与首轮计划一起变。拆开之后页面会在「档位换了」和「进度换了」之间
 * 渲染出一帧自相矛盾的中间态。
 */
export const TierLevelPlanResponseSchema = z.object({
  levelId: z.string(),
  microKpId: z.string(),
  tier: TierNameSchema,
  /** 参数来源：定级记录还是默认回落（同 `TierOverviewResponse.source`） */
  source: z.enum(['placement', 'fallback']),
  params: TierParamsSchema,
  firstRound: FirstRoundPlanSchema,
  /** 按本档的掌握判定规则，这个知识点还差什么 */
  masteryProgress: TierMasteryProgressSchema,
});

export type TierLevelPlanResponse = z.infer<typeof TierLevelPlanResponseSchema>;

/**
 * 一次档位变更（票 12 验收 3：升降级写进学习日志，用户能看到「为什么给我降档了」）。
 *
 * 字段与 `PlacementRejudgeEvent` 高度重叠，但**不复用**：那个是「定级结果的重判」，
 * 这个是「学习日志里的一条档位事件」。合并会让其中一边加字段时另一边被迫跟着变。
 */
export const TierChangeSchema = z.object({
  /** 学习日志里那条事件的 id（字符串形式）。列表 key 与去重都用它 */
  id: z.string(),
  /** 变更发生的时刻（ISO 8601） */
  at: z.string(),
  previousTier: TierNameSchema,
  tier: TierNameSchema,
  changed: z.boolean(),
  /** 触发这次重评时「自上次定级/重评以来累计的作答数」 */
  attemptsSince: z.number().int().min(0),
  /** 首轮正确率；没有可算的样本时为 null（不是 0） */
  averageFirstTryRate: z.number().min(0).max(1).nullable(),
  /** 中文说明，引用具体数字。**这就是界面上「为什么」那句话的来源** */
  explanation: z.string(),
});

export type TierChange = z.infer<typeof TierChangeSchema>;

/**
 * 档位变更历史（新的在前）。
 *
 * `items` 为空数组是正常状态（从没重评过），不是 null。
 */
export const TierChangesResponseSchema = z.object({
  items: z.array(TierChangeSchema),
});

export type TierChangesResponse = z.infer<typeof TierChangesResponseSchema>;

/**
 * 本次会话的下一步计划（票 12 第二维「单次会话新知识点上限 2/3/4」的落点）。
 *
 * 为什么单独一个端点而不是塞进推荐列表：推荐列表回答「学什么最好」，
 * 这个回答「这一档一次最多开几个新知识点」。P1 学习者拿到 4 条推荐时，
 * 界面必须只放行 2 条，其余明说「下次会话再开」——否则「会话上限」这个参数
 * 只存在于数据库里。
 */
export const TierSessionPlanResponseSchema = z.object({
  tier: TierNameSchema,
  source: z.enum(['placement', 'fallback']),
  /** 这一档单次会话最多开几个新知识点 */
  limit: z.number().int().min(1),
  /** 建议本次会话开始的知识点，数量 ≤ `limit` */
  items: z.array(
    z.object({
      microKpId: z.string(),
      name: z.string(),
      /** 是否已经有生成好的关卡；没有时界面给「生成关卡」入口 */
      hasLevel: z.boolean(),
    }),
  ),
  /**
   * 被上限挡在本次会话之外的推荐数。
   *
   * 0 表示「没有更多推荐了」；>0 表示「还有 N 个，下次会话再开」。这两种情况
   * 对学习者显示的话不同，所以不能合成一个 `items.length` 就完事。
   */
  deferred: z.number().int().min(0),
});

export type TierSessionPlanResponse = z.infer<typeof TierSessionPlanResponseSchema>;
