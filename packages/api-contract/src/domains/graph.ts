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
  /**
   * 书名（`app.sources.title`），票 07：列表搜索的重名消歧靠它。库里
   * 3000+ 节点大量重名（「信号」「小结」），不带书名，「找到的是哪本书的
   * 那一个」就说不清，mockup 承诺的消歧做不出来。
   *
   * **必填但可为 null**：null = 手工知识点（`source_id` 为 NULL 的 3 个
   * 示例节点），不是「字段没实现」——与本文件 `source` 的必填可为 null
   * 同一条理由。null 与空串是两件事：「没有教材出处」不拼「」占位。
   *
   * 不带 `pageLabel` 句子：列表是给本地索引（票 07 的搜索）吃的**数据**，
   * 给人看的句子只在详情接口拼一次（`pageLabel` 先例）。
   */
  sourceTitle: z.string().nullable(),
  /** 印刷页码（`knowledge_points.source_page`）：纯数字输入按页码搜靠它。null 语义同 `sourceTitle`。 */
  page: z.number().int().positive().nullable(),
});

/** GET /api/v1/nodes */
export const NodeListResponseSchema = z.object({
  items: z.array(NodeStateSchema),
  nextCursor: z.string().nullable(),
});

/**
 * 一个知识点「来自哪本书、哪一页」（票 18 验收 6）。
 *
 * ## 为什么 `pageLabel` 由服务端拼好，而不是前端拿 title + page 自己拼
 *
 * 因为拼法只有一处该有：`「辐射探测与测量（Knoll 第4版 2010）」第 12 页` 这个
 * 形状里，书名要不要加书名号、页码要不要带「第」、分隔用什么，都是**文案**。
 * 放到前端就意味着两个页面（知识点详情、将来的关卡来源提示）各拼一次，改一次
 * 措辞要改两处，而且没有任何东西会提醒你漏了一处。
 *
 * 数值字段仍然原样给（`title` / `page`），因为将来「跳到该书的这一页」或
 * 「按书筛选」需要的是数据而不是句子。**句子给人看，字段给机器用**，两个都给。
 *
 * ## 为什么 `page` 是正数
 *
 * `app.knowledge_points.source_page` 实测 7309 行里零个空值、最小值 1。页码 0
 * 在印刷书里不存在；真出现 0 说明入库把「未知」写成了 0，那时宁可让 Zod 抛错
 * 也不要让学习者看到「第 0 页」。
 */
export const NodeSourceSchema = z.object({
  /** `app.sources.id`，如 `knoll-4e-2010` */
  sourceId: z.string(),
  /** 中文书名，来自 `app.sources.title` */
  title: z.string(),
  /** 书里的印刷页码（不是 PDF 页序） */
  page: z.number().int().positive(),
  /** 给人看的中文串，如 `「辐射探测与测量（Knoll 第4版 2010）」第 12 页` */
  pageLabel: z.string(),
});

/** GET /api/v1/nodes/:microKpId */
export const NodeDetailResponseSchema = z.object({
  node: NodeStateSchema,
  levels: z.array(LevelSummarySchema),
  /** 一句话说明「为什么推荐这个」，前端直接展示 */
  reasons: z.array(z.string()),
  /**
   * 这个知识点出自哪本书哪一页（票 18 验收 6）。
   *
   * **必填但可为 null**，两种「没有」必须区分开：
   *
   * - `null` = 这条知识点**本来就没有教材出处**。全库只有 3 个这样的节点，
   *   是手工种的示例知识点（`kp-bool` / `kp-kmap` / `kp-logic`，`source_id`
   *   为 NULL），它们必须能在界面上被点开，不能因为查不到来源就 404。
   * - 字段缺失 = 接口没实现这件事。**这才是缺陷。** 所以字段是必填的：
   *   可选字段（`source?:`）会让前端少写一个 `?.` 就在运行时拿到 `undefined`，
   *   页面静默不显示来源，而没人会发现 —— 与 `GraphResponse.contentGaps`
   *   同一个理由。
   *
   * 真实书的节点 `source` 为 null 就是数据缺陷（`source_id` 悄悄丢了），
   * `nodes.controller.test.ts` 有一条 count 断言专门守这件事。
   */
  source: NodeSourceSchema.nullable(),
  /**
   * 章节路径（票 08）：从根到直接父级的祖先名，**根在前、不含自身**，
   * 如 `['第 1 章 逻辑代数', '第 1.2 节 布尔恒等式']`。
   *
   * **必填，空数组是合法态**：手工种的示例知识点没有父级，此时是 `[]`
   * 而不是字段缺失——与上面 `source` 的必填可为 null 同一条理由：可选字段
   * （`ancestors?:`）会让前端少写一个 `?.` 就在运行时拿到 `undefined`，
   * 页面把「我在哪」渲染成空白或 `undefined · undefined`，而没人会发现。
   *
   * 为什么是 `string[]` 而不是 `string`（拼好的「章 · 节」）：分隔符是前端
   * 文案（不同行宽下可能换成换行），而「哪几级、什么顺序」是数据。这与
   * `pageLabel` 的分工相反但同一条原则：拼法只允许存在一处——pageLabel 的
   * 拼法在服务端只有一处、此处路径的组装在前端只有一处。
   */
  ancestors: z.array(z.string()),
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
 * 一处**资源库里没有对口教材**的内容缺口（票 18 验收第 5 条）。
 *
 * ## 为什么缺口要随图谱一起返回，而不是单独一个接口
 *
 * 缺口的语义是「你走到这儿，往后就没有教材了」——它只有在**跟节点摆在一起**
 * 的时候才成立。单独一个 `/content-gaps` 接口要求前端先拉图、再拉缺口、然后
 * 自己想办法告诉用户「这三个缺口在你现在看到的这张图的哪个位置」，而缺口本身
 * 并不带坐标：它指向的是「课程表上本该有、资源库里没有」的东西。所以它只能
 * 贴着图走。
 *
 * ## 为什么 `nearestKpIds` 是数组且可能是空
 *
 * 它是给学习者的**提示**（「你大概学到这儿了」），不是归属关系，所以：
 *
 * - 可以有多条候选（同一主题在不同书里各有一节）；
 * - 可以为空 —— 数据库里解析不到对应知识点时，缺口照常显示，只是没有可点的
 *   跳转。**不能**因为解析不到就把整条缺口过滤掉：那样「缺内容」这件事会随
 *   知识点重导入而静默消失，恰恰是最需要它出现的时刻。
 *
 * 顺序有意义：前端只取第一个做跳转入口，所以数组按「最接近课程终点」排。
 *
 * ## 为什么 `expectedRole` 是这三个值
 *
 * 它回答「这个缺口在课程层里本该是什么角色」，决定界面上那句话怎么写：
 * `prereq` = 缺了它后面的课没法开始；`core` = 主干缺一节；`advanced` = 课程
 * 到这儿为止，再往后得另找教材。三条缺口当前全是 `advanced` —— 本科大纲的
 * 终点就是多道分析器。
 */
export const ContentGapSchema = z.object({
  id: z.string(),
  /** 缺的是什么（一个名词短语，直接做小标题） */
  topic: z.string(),
  /** 为什么算缺口 —— 一句话，带可核验的出处（哪几份大纲、哪门课） */
  reason: z.string(),
  expectedRole: z.enum(['prereq', 'core', 'advanced']),
  /** 图谱上最接近这个缺口的叶节点 id，按接近程度排序；可为空 */
  nearestKpIds: z.array(z.string()),
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
  /**
   * 资源库的内容缺口（票 18 验收第 5 条）。
   *
   * **必填，不是可选。** 可选字段在 TypeScript 里是 `contentGaps?: ...`，前端
   * 少写一个 `?.` 就会在运行时拿到 `undefined`，然后 `contentGaps.length` 抛错
   * 或者渲染成空白 —— 而「渲染成空白」与「本来就没有缺口」在界面上长得一模
   * 一样，这个功能会静默死掉且没人发现。必填意味着后端漏填时 `parse()` 当场
   * 抛 ZodError（500 + 明确报错），而不是安静地少一块。
   *
   * 空数组是合法且常见的一态：资源库补齐之后缺口就该是空的，界面据此不渲染
   * 这一块。所以「空」与「字段缺失」必须能区分开。
   */
  contentGaps: z.array(ContentGapSchema),
  /**
   * 与 `GET /api/v1/recommendations` **同一时刻、同一批**的推荐节点 id。
   *
   * 票 13 验收第 5 条：「图谱与看板推荐同一时刻指向同一批节点，不出现两处
   * 矛盾」。做到这一点不能靠「两边各算一遍然后希望结果一样」——那在数据
   * 更新的一瞬间就会漂移，而且没人能复现。唯一的办法是**两边调同一个函数**
   * （`@starmap/engine` 的 `recommend()`），并把算出来的 id 一起放进图谱
   * 响应里，好让界面和测试都能直接对照。
   *
   * 顺序有意义：就是推荐的优劣顺序。空数组表示「此刻没有可推荐的节点」
   * （例如全部已掌握，或全部被改道排除），不是「功能没接通」。
   */
  recommendedIds: z.array(z.string()),
});

/**
 * 推荐理由里的一条**结构化事实**。
 *
 * 为什么不返回中文句子：句子一旦在服务端拼好，前端就没法把数字加粗、没法把
 * 「解开谁」渲染成可点链接；改一个措辞还要动后端与测试。而且测试只能正则
 * 抠字符串里的数字 —— 那测的是格式不是数据。
 *
 * 数值一律是**原值**（`0.32` 而不是 `"32%"`）：图谱保留一位小数、看板取整，
 * 两处精度规则不同，在服务端定死就回不去了。
 *
 * 这些 `type` 与 `packages/engine/src/recommend.ts` 的 `ReasonFact` 逐字对应
 * （引擎是计算处，契约是传输形状，两者若漂移有类型测试兜底）。
 */
export const ReasonFactSchema = z.discriminatedUnion('type', [
  /** 当前掌握度（衰减后）。管推荐的那个数 */
  z.object({ type: z.literal('current'), value: z.number().min(0).max(1) }),
  /** 历史最高掌握度。不衰减，用来区分「学会了但忘了」与「从没学会」 */
  z.object({ type: z.literal('achieved'), value: z.number().min(0).max(1) }),
  z.object({ type: z.literal('attempts'), value: z.number().int().min(0) }),
  z.object({ type: z.literal('variants'), value: z.number().int().min(0) }),
  /** 熟悉线（0.4）。理由里出现「低于 40%」时，这个 40 也必须是可追溯的常量 */
  z.object({ type: z.literal('familiarThreshold'), value: z.number().min(0).max(1) }),
  z.object({ type: z.literal('requiredAttempts'), value: z.number().int().min(1) }),
  z.object({ type: z.literal('requiredVariants'), value: z.number().int().min(1) }),
  z.object({ type: z.literal('halfLifeDays'), value: z.number().min(0) }),
  /** 这个推荐能解开哪个卡住的节点 */
  z.object({
    type: z.literal('unblocks'),
    microKpId: z.string(),
    name: z.string(),
    current: z.number().min(0).max(1),
  }),
  /** 该节点的先修里已经满足几个 */
  z.object({ type: z.literal('prereqsSatisfied'), value: z.number().int().min(0) }),
]);

/**
 * 理由的种类。每一种都对应一个**学习者可据以行动的事实**，
 * 不是「根据你的学习情况」这类可以套在任何节点上的空话。
 */
export const ReasonKindSchema = z.enum([
  /** 到了该复验的时候（排期由票 07 写入） */
  'review_due',
  /** 你在某个节点上卡住，而它依赖的这个前置你也没掌握 */
  'blocked_by_prereq',
  /** 曾经掌握过，但按半衰期衰减了 */
  'fading',
  /** 证据还不够，再做几题判断才准 */
  'needs_evidence',
  /** 做过题，但当前掌握度还低 */
  'low_mastery',
  /** 先修都满足了，可以开始学这个新知识点 */
  'next_in_line',
]);

export const RecommendationReasonSchema = z.object({
  kind: ReasonKindSchema,
  facts: z.array(ReasonFactSchema),
});

/** 今日推荐里的一条。 */
export const RecommendationSchema = z.object({
  microKpId: z.string(),
  name: z.string(),
  /** 主线上的位置，让用户知道「这是哪一章的」 */
  moduleName: z.string(),
  reason: RecommendationReasonSchema,
});

/**
 * 今日学习摘要。
 *
 * **`available` 与三个数字是一对，前端只认 `available`。**
 *
 * 为什么不是一个「有数据就是 true」的推断：`attempts` 表为空时，三个数字
 * 都算得出 0，而「今天答了 0 题」和「作答记录还没接通」是两件事。显示 0 是
 * 在撒谎（说「你今天什么都没做」），真相是「我们还不知道」。这与
 * 「证据不足不给 0%」是同一条原则：**没有数据源就不给数字**。
 *
 * 所以服务端必须显式回答「这个数字有没有真数据源」，而不是让前端按票的
 * 完成顺序去猜。票 05 之后 `attempts` 就是真数据源，`available` 恒为 true；
 * 但在那之前（或某个只读环境里表不存在时）它可以诚实地为 false。
 */
export const TodaySummarySchema = z.object({
  available: z.boolean(),
  /** 今日作答次数 */
  answered: z.number().int().min(0),
  /** 今日涉及的微知识点数 */
  knowledgePoints: z.number().int().min(0),
  /** 今日新达到「已掌握」的微知识点数 */
  newlyMastered: z.number().int().min(0),
});

/** GET /api/v1/recommendations */
export const RecommendationListResponseSchema = z.object({
  recommendations: z.array(RecommendationSchema),
  summary: TodaySummarySchema,
  /**
   * 这一批推荐算出来的时刻（ISO）。与响应里所有数字共享同一个时间基准，
   * 所以「同一时刻指向同一批节点」这件事可以被断言，而不是靠运气。
   */
  generatedAt: z.string(),
});

/**
 * POST /api/v1/recommendations/redirect
 *
 * `recommended` = 被拒绝的那条，`chosen` = 用户改道去学的。
 * 服务端不校验 chosen 是否在候选集里：用户可以直接选一个我们没推荐的节点
 * （那正是「一键改道」的意义）。
 */
export const RedirectRequestSchema = z.object({
  recommended: z.string(),
  chosen: z.string(),
});

export const RedirectResponseSchema = z.object({
  /** 记录已落库。前端据此提示「换一个」成功，不需要再拉一次全量 */
  ok: z.boolean(),
});

export type MasteryState = z.infer<typeof MasteryStateSchema>;
export type NodeState = z.infer<typeof NodeStateSchema>;
export type NodeListResponse = z.infer<typeof NodeListResponseSchema>;
export type NodeSource = z.infer<typeof NodeSourceSchema>;
export type NodeDetailResponse = z.infer<typeof NodeDetailResponseSchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type ContentGap = z.infer<typeof ContentGapSchema>;
export type GraphResponse = z.infer<typeof GraphResponseSchema>;
export type ReasonFact = z.infer<typeof ReasonFactSchema>;
export type ReasonKind = z.infer<typeof ReasonKindSchema>;
export type RecommendationReason = z.infer<typeof RecommendationReasonSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;
export type TodaySummary = z.infer<typeof TodaySummarySchema>;
export type RecommendationListResponse = z.infer<typeof RecommendationListResponseSchema>;
export type RedirectRequest = z.infer<typeof RedirectRequestSchema>;
export type RedirectResponse = z.infer<typeof RedirectResponseSchema>;
