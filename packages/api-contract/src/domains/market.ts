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
