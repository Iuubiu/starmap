/**
 * 关卡市场领域契约（票 14 / 16 的落点）。
 *
 * 归属泳道：authoring-dev。领域文件由该泳道增改，`src/index.ts` 的 re-export 行
 * 已经预先写好，加 schema 不需要动共享文件。
 *
 * ## 这里为什么**没有** LevelSpec 的定义
 *
 * `level.spec.json` 的真源是 `packages/shared/src/domain/level.ts` —— 校验器必须
 * 能在纯函数环境（无 Nest、无 DB）里跑，契约包不是它的住所。把 schema 抄一份
 * 到这里，就会出现「市场里合法的关卡」与「内置关卡合法」两套标准，这是这类
 * 系统最常见的腐烂方式。
 *
 * 所以本文件里 `spec` 一律是 `unknown`：
 *   - 入参不在这里做结构校验，交给 `validateLevelSpec()`（唯一的规则集）；
 *   - 草稿本身就是「还不合法」的东西，用 LevelSpec 类型化它会自欺欺人 ——
 *     字段级错误才是草稿的真实状态，见 `MarketSpecIssue`。
 *
 * `unknown` 在 OpenAPI 里渲染成自由对象，前端拿到的是 `unknown`，这与它真实的
 * 可信程度一致：未经 `/market/levels` 的 422 检查前，它就是一段任意 JSON。
 */
import { z } from 'zod';

/**
 * 一条字段级错误，形状与 `validateLevelSpec()` 的 issue 完全一致。
 *
 * `path` 是**点号**形式（`steps.1.itemIds.0`），前端展示时转成
 * `steps[1].itemIds[0]`。两处格式必须同源，否则「校验说这里错、编辑器高亮
 * 那里」会指错字段。
 */
export const MarketSpecIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string(),
});

export type MarketSpecIssue = z.infer<typeof MarketSpecIssueSchema>;

/** 关卡来源：预制（系统内容）还是自己保存的 */
export const MarketLevelOriginSchema = z.enum(['preset', 'saved']);

/** 关卡作者，与 `level.spec.json` 的 `meta.author` 同集合 */
export const MarketLevelAuthorSchema = z.enum(['system', 'teacher', 'self', 'ai']);

export type MarketLevelOrigin = z.infer<typeof MarketLevelOriginSchema>;
export type MarketLevelAuthor = z.infer<typeof MarketLevelAuthorSchema>;

/**
 * 市场卡片。字段是 `level.spec.json` 里能被列表页用上的那一层摘要，
 * 加上市场登记信息。
 *
 * `author` 从 `levels.spec.meta.author` 派生，不落库 —— 它已经是 spec 的字段，
 * 存两份会在某次保存后不一致。
 */
export const MarketLevelSummarySchema = z.object({
  levelId: z.string(),
  microKpId: z.string(),
  microKpName: z.string(),
  title: z.string(),
  kind: z.enum(['teach', 'quiz', 'mixed']),
  author: MarketLevelAuthorSchema,
  itemCount: z.number().int().min(0),
  /** 预制关卡为 null */
  savedAt: z.string().nullable(),
  tags: z.array(z.string()),
  origin: MarketLevelOriginSchema,
});

/**
 * GET /api/v1/market/levels
 *
 * 一次返回两类，不分开两个请求：市场页是一屏列表，预制与自保存在一起才有
 * 「我有起点，也能留东西」的观感。前端按 `origin` 分组即可。
 */
export const MarketLevelListResponseSchema = z.object({
  items: z.array(MarketLevelSummarySchema),
});

export type MarketLevelSummary = z.infer<typeof MarketLevelSummarySchema>;
export type MarketLevelListResponse = z.infer<typeof MarketLevelListResponseSchema>;

/** POST /api/v1/market/drafts —— 把一段学习过程打包成草稿 */
export const MarketDraftRequestSchema = z.object({
  /** 要打包的微知识点 */
  microKpId: z.string().min(1),
  /** 可选：只打包这次学习会话里发生的事 */
  sessionId: z.string().min(1).nullable().optional(),
});

/** 草稿里的一条题目证据：来自哪道题、当时对没对、错因标签 */
export const MarketDraftItemSchema = z.object({
  itemId: z.string(),
  stem: z.string(),
  /** null = 没有作答记录，只是被这个知识点的关卡引用过 */
  correct: z.boolean().nullable(),
  misconceptionTags: z.array(z.string()),
});

export type MarketDraftItem = z.infer<typeof MarketDraftItemSchema>;

/**
 * 草稿的来源说明。
 *
 * 这一块是票 14 验收①的可见形式：不是「我们打包了一个 spec」，
 * 而是「我看过的这几张卡、做错的这几道题被打包进去了」。
 */
export const MarketDraftLearningSchema = z.object({
  microKpId: z.string(),
  microKpName: z.string(),
  /** 引用了多少个作答记录；为 0 时说明这段学习还没有作答证据 */
  attemptCount: z.number().int().min(0),
  correctCount: z.number().int().min(0),
  items: z.array(MarketDraftItemSchema),
  /** 讲解片段的 id（来自各关卡 spec 的 cards） */
  cardIds: z.array(z.string()),
  /** 打包时参考了哪些已有关卡 */
  sourceLevelIds: z.array(z.string()),
});

export type MarketDraftLearning = z.infer<typeof MarketDraftLearningSchema>;

/** POST /api/v1/market/drafts 的响应 */
export const MarketDraftResponseSchema = z.object({
  /**
   * 草稿本体。**可能是非法的** —— 这正是它的用途：草稿的字段级缺项在
   * `issues` 里，用户补全后由 POST /market/levels 再校验一次才入库。
   */
  spec: z.unknown(),
  issues: z.array(MarketSpecIssueSchema),
  learning: MarketDraftLearningSchema,
});

export type MarketDraftRequest = z.infer<typeof MarketDraftRequestSchema>;
export type MarketDraftResponse = z.infer<typeof MarketDraftResponseSchema>;

/**
 * POST /api/v1/market/levels —— 保存关卡的请求体。
 *
 * `spec` 是 `unknown`：结构校验由 `validateLevelSpec()` 做，它同时是播放器、
 * 内容入库和这里用的那一套。在这里再 `LevelSpecSchema.parse` 一遍会产生两种
 * 错误文案（一条来自 Zod 原始 issue，一条来自校验器），前端只能挑一种展示。
 */
export const MarketSaveLevelRequestSchema = z.object({
  spec: z.unknown(),
  tags: z.array(z.string()).max(12).optional(),
});

/**
 * GET /api/v1/market/levels/:levelId
 *
 * 带上完整 `spec`，因为市场页的「重新开始」与「继续编辑」都要用它：
 * 前者交给播放器（同一份 React 组件，只认 spec 不认来源），后者灌回编辑器。
 * 再单开一个「拿 spec」的端点会让这两条路径各拿一次，且可能拿到不同版本。
 */
export const MarketLevelDetailResponseSchema = z.object({
  level: MarketLevelSummarySchema,
  spec: z.unknown(),
});

export const MarketSaveLevelResponseSchema = z.object({
  level: MarketLevelSummarySchema,
  /**
   * false = 这次是覆盖保存（同 id 已存在）。
   *
   * 这个字段不是装饰：票 16 的批量生成要求幂等，重复执行必须能分辨
   * 「新建了」与「已经在了」；前端也靠它把「已保存」和「更新了」说清楚。
   */
  created: z.boolean(),
});

export type MarketSaveLevelRequest = z.infer<typeof MarketSaveLevelRequestSchema>;
export type MarketSaveLevelResponse = z.infer<typeof MarketSaveLevelResponseSchema>;
export type MarketLevelDetailResponse = z.infer<typeof MarketLevelDetailResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 票 16：AI 批量生成
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 一次批量生成的状态。
 *
 * `partial` 单独存在而不是用「成功数 > 0 且失败数 > 0」推断：状态是要给人和
 * 程序同时读的，字符串 `partial` 能直接进日志和 UI 文案，而两个计数字段的
 * 组合有四种情况需要调用方自己判。
 */
export const GenerationRunStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'partial',
  'failed',
]);

export type GenerationRunStatus = z.infer<typeof GenerationRunStatusSchema>;

/**
 * 失败分类（与 `level_generation_task.failure_kind` 的 CHECK 一一对应）。
 *
 * 为什么是枚举而不是自由文本：验收⑤要求「可汇总查看」。自由文本会让
 * 12 条失败变成 12 种同义不同字的说法，`GROUP BY` 出来等于没分组。
 */
export const GenerationFailureKindSchema = z.enum([
  'llm_error',
  'not_json',
  'schema_invalid',
  'missing_field',
  'language_not_compliant',
  'ungrounded_source',
  'practice_violation',
  'db_error',
]);

export type GenerationFailureKind = z.infer<typeof GenerationFailureKindSchema>;

/** 每个知识点一条执行明细 */
export const GenerationTaskSchema = z.object({
  taskId: z.string(),
  microKpId: z.string(),
  microKpName: z.string(),
  status: z.enum(['pending', 'running', 'succeeded', 'failed']),
  failureKind: GenerationFailureKindSchema.nullable(),
  failureMessage: z.string().nullable(),
  /**
   * 字段级明细。成功时为 null；schema_invalid 时是 `validateLevelSpec()` 的
   * issues（`{path,message,code}` 数组，与市场保存的 422 details 同源）。
   */
  failureDetail: z.unknown(),
  levelId: z.string().nullable(),
  levelTitle: z.string().nullable(),
  itemCount: z.number().int().min(0),
  /** 这条任务被尝试过几次。幂等重跑时递增，用于分辨「一次就好」与「反复失败」 */
  attempts: z.number().int().min(0),
  durationMs: z.number().int().min(0).nullable(),
});

export type GenerationTask = z.infer<typeof GenerationTaskSchema>;

/**
 * 失败原因汇总的一行。
 *
 * 这是验收⑤「可汇总查看」的落点：不是让前端自己 group，
 * 而是后端直接给出「这一批里 schema_invalid 失败 3 条」这种结论。
 */
export const GenerationFailureSummarySchema = z.object({
  kind: GenerationFailureKindSchema,
  count: z.number().int().min(1),
  /** 这一类的典型报错原文（取最早的一条），用于把分类翻成人话 */
  sample: z.string(),
});

export type GenerationFailureSummary = z.infer<typeof GenerationFailureSummarySchema>;

/** 一次批量执行的完整视图（跑的过程中轮询这个看进度） */
export const GenerationRunSchema = z.object({
  runId: z.string(),
  /**
   * 本次关心的知识点总数。
   *
   * 与 `tasks.length` 在**未开始的运行**上可能不同：那一阶段只有计数没有明细。
   * 但一旦开始跑，两者必然相等 —— 明细是在运行开始时一次性建齐的，
   * 这样「进度 3/8」不会因为中途插入新行而分母漂移。
   */
  requestedCount: z.number().int().min(0),
  succeededCount: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  concurrency: z.number().int().min(1),
  tasks: z.array(GenerationTaskSchema),
  failures: z.array(GenerationFailureSummarySchema),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});

export type GenerationRun = z.infer<typeof GenerationRunSchema>;

/**
 * POST /api/v1/market/generations —— 发起一次批量生成。
 *
 * `microKpIds` 与 `limit` 二选一：
 *   - 给了 id 列表就跑这些（去重后按传入顺序，便于复现同一批）
 *   - 只给 limit 就按「最缺关卡的叶子知识点」自动挑
 *
 * 两者都不给时默认 `limit=4`。故意不设「跑全部 167 个知识点」的默认值：
 * 那是一次昂贵且不可逆的写操作，不该由省略参数触发。
 */
export const GenerationRunRequestSchema = z
  .object({
    microKpIds: z.array(z.string().min(1)).max(50).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    /** 并发度。默认 4（票 16 的要求），上限 8 防止把上游限流打爆 */
    concurrency: z.number().int().min(1).max(8).optional(),
    /**
     * 是否等这批跑完再返回。
     *
     * 默认 false（后台跑，立刻返回 runId 供轮询）—— 票 16 要求「可后台跑
     * 并观察进度」。设 true 只给测试与 CLI 用，便于一条命令拿到最终结果。
     */
    wait: z.boolean().optional(),
  })
  .refine((v) => v.microKpIds !== undefined || v.limit !== undefined, {
    message: 'microKpIds 与 limit 至少要给一个（不提供「跑全部知识点」的默认行为）',
    path: ['limit'],
  });

export type GenerationRunRequest = z.infer<typeof GenerationRunRequestSchema>;

/**
 * 发起（或查询）一次批量生成的响应。
 *
 * 直接用 `GenerationRunSchema`，不另造一个 `GenerationRunResponseSchema` 别名：
 * 别名会让 emit 的双向检查认为有两个组件，而它们的形状逐字相同 —— 那正好是
 * 「同一个形状两个名字」的腐烂起点，Orval 会生成两个互不兼容的类型。
 */
export type GenerationRunResponse = GenerationRun;

/** GET /api/v1/market/generations —— 最近若干次运行（只给头部，不带每条明细） */
export const GenerationRunListResponseSchema = z.object({
  items: z.array(
    z.object({
      runId: z.string(),
      status: GenerationRunStatusSchema,
      requestedCount: z.number().int().min(0),
      succeededCount: z.number().int().min(0),
      failedCount: z.number().int().min(0),
      createdAt: z.string(),
      finishedAt: z.string().nullable(),
    }),
  ),
});

export type GenerationRunListResponse = z.infer<typeof GenerationRunListResponseSchema>;
