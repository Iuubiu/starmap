/**
 * 智能体与检索领域契约（票 08 / 09 / 10 / 15）。
 *
 * 归属泳道：agent-dev。`src/index.ts` 的 re-export 行已经预置好，加 schema
 * 不需要动共享文件；配套的 paths 片段在 `scripts/paths/agent.mjs`。
 *
 * ## 为什么这里要有「产物卡」而不是消息
 *
 * 票 08 的核心不是「做一个更好看的聊天框」，而是把回合产出的**类型**写成契约：
 * 一次回合的结果只可能是四种产物之一（关卡卡 / 图谱聚焦 / 进度变化 / 追问表单），
 * 前端因此可以按 kind 分派渲染器，而不是把一段自由文本塞进 `<p>`。历史是
 * 学习日志（`AgentTurnRecordSchema`），不是消息流——所以这里**没有** role 字段。
 *
 * ## 降级为什么用独立的 errorCard 而不是第五种产物
 *
 * 票 08 要求「模型两次返回非法 JSON 时降级为可读的错误卡」。错误卡不是学习
 * 产物，把它塞进四元 union 会让「产物有四种」这条约束从类型上失效。所以
 * `artifact` 与 `errorCard` 互斥且必有其一（`superRefine` 保证），前端可以
 * 只依赖「二者恰好非空一个」这个不变量。
 *
 * ## 内部推理字段
 *
 * 这个文件里**没有**也不会有 `reasoning` / `rationale_internal` / `thinking`
 * 之类字段：契约层先把它挡在门外，比依赖每个渲染点记得删更可靠。服务端在
 * parse 之前就剥掉这些键（见 `apps/api/src/agent/artifact.ts` 的
 * `stripInternalFields`），因此它们既进不了响应，也进不了 DOM。
 */
import { z } from 'zod';
import { MasteryStateSchema } from './graph.js';

/** 学生水平档（spec §5）。追问阶梯起始与上限都挂在它上面。 */
export const LearnerTierSchema = z.enum(['P1', 'P2', 'P3']);

/* ------------------------------------------------------------------ *
 * 票 08：结构化回合
 * ------------------------------------------------------------------ */

/** 产物卡上的动作。「再试一次」与「看依据」是票 08 点名的两类。 */
export const AgentCardActionKindSchema = z.enum(['retry', 'show_evidence']);

export const AgentCardActionSchema = z.object({
  kind: AgentCardActionKindSchema,
  label: z.string(),
  enabled: z.boolean(),
});

/** 四张产物卡共有的字段：有名字、可回看、能定位。 */
const artifactBase = {
  cardId: z.string(),
  title: z.string(),
  createdAt: z.string(),
};

/** 关卡卡：把「去学这个」变成一张可以直接点进去的卡。 */
export const LevelCardArtifactSchema = z.object({
  ...artifactBase,
  kind: z.literal('level_card'),
  levelId: z.string(),
  microKpId: z.string(),
  tier: LearnerTierSchema,
  estimatedMinutes: z.number().int().min(1),
  itemCount: z.number().int().min(0),
  /** 首步是什么形态，决定卡上写「先看讲解」还是「直接出题」 */
  firstStepKind: z.enum(['guide', 'detail', 'probe', 'deepen', 'reteach', 'quiz', 'summary']),
  /** 一句话说明「为什么给你这张卡」，必须是可读的中文句子 */
  rationale: z.string(),
});

/** 图谱聚焦：把知识地图移到某个知识点和它的邻居上。 */
export const GraphFocusArtifactSchema = z.object({
  ...artifactBase,
  kind: z.literal('graph_focus'),
  microKpId: z.string(),
  name: z.string(),
  neighbors: z.array(
    z.object({
      microKpId: z.string(),
      name: z.string(),
      relation: z.enum(['prereq', 'related', 'part_of']),
      direction: z.enum(['in', 'out']),
      state: MasteryStateSchema,
    }),
  ),
  rationale: z.string(),
});

const masterySnapshot = z.object({
  achieved: z.number().min(0).max(1),
  current: z.number().min(0).max(1),
  state: MasteryStateSchema,
});

/** 进度变化：让「刚才那一步带来了什么」可见（spec §6 D1 的可见进度）。 */
export const ProgressChangeArtifactSchema = z.object({
  ...artifactBase,
  kind: z.literal('progress_change'),
  microKpId: z.string(),
  name: z.string(),
  before: masterySnapshot,
  after: masterySnapshot,
  /** 为什么变了——禁止只显示一个 +0.08 */
  reason: z.string(),
  evidenceCount: z.number().int().min(0),
});

/** 追问表单：一次只问一个问题，答案从这里收。 */
export const ProbeFormArtifactSchema = z.object({
  ...artifactBase,
  kind: z.literal('probe_form'),
  probeId: z.string(),
  microKpId: z.string(),
  question: z.string(),
  /** 1–5 级求助阶梯的当前级；上限由非 LLM 策略核心决定 */
  ladderLevel: z.number().int().min(1).max(5),
  ladderCap: z.number().int().min(1).max(5),
  inputKind: z.enum(['free_text', 'choice']),
  choices: z.array(z.string()),
  actions: z.array(AgentCardActionSchema),
  /**
   * 为什么给它这道追问。
   *
   * 四张卡都要能回答「我为什么看到这个」，所以 `rationale` 不只在另外三种卡
   * 上有。追问卡尤其需要：学生被反问一步时最想知道的是「你为什么问我这个」。
   */
  rationale: z.string(),
});

/**
 * 回合产物。**四种**，不多不少——降级用的错误卡是独立字段，不是第五种。
 */
export const AgentArtifactSchema = z.discriminatedUnion('kind', [
  LevelCardArtifactSchema,
  GraphFocusArtifactSchema,
  ProgressChangeArtifactSchema,
  ProbeFormArtifactSchema,
]);

export const AgentArtifactKindSchema = z.enum([
  'level_card',
  'graph_focus',
  'progress_change',
  'probe_form',
]);

/** 降级卡：只在模型连续两次给出非法 JSON 时出现。可读、可重试、可排查。 */
export const AgentErrorCardSchema = z.object({
  title: z.string(),
  detail: z.string(),
  retryable: z.boolean(),
  /** 服务端日志的定位串。**不放模型原文**——原文可能含答案。 */
  debugId: z.string(),
});

/** 语言校验结论（spec §10 / D10 全中文）。 */
export const AgentLanguageCheckSchema = z.object({
  ok: z.boolean(),
  /** 违反中文约束的英文词，前端据此标红 */
  offenders: z.array(z.string()),
});

/**
 * `visibleResponse` 的形态。
 *
 * 票 08 要求「必须以 ? 结尾（追问形态）或被明确标记为非追问」。用一个显式
 * 枚举而不是布尔，是因为布尔的两个值在日志里读不出含义，而 `probe_question`
 * / `statement` 一眼就知道这句是什么。
 */
export const VisibleResponseKindSchema = z.enum(['probe_question', 'statement']);

/** POST /api/v1/agent/turns */
export const AgentTurnRequestSchema = z.object({
  sessionId: z.string().min(1),
  utterance: z.string().min(1).max(2000),
  /** 当前聚焦的微知识点；为空表示学生还没选 */
  microKpId: z.string().nullable().default(null),
  tier: LearnerTierSchema.default('P1'),
});

/**
 * 「问津」：出关卡之前先确认学习意图（票 79）。
 *
 * ## 为什么它不是第五种产物卡
 *
 * 产物卡回答「这一轮给你什么」，四类已经封闭；`clarify` 回答的是**这一轮还
 * 不该给东西**——学生只说了「我想学布尔代数」，系统无法判断该按考试深度还是
 * 按看懂论文的深度出题。所以 `clarify` 是响应的一个可选字段，伴随一张
 * `probe_form` 卡（复用同一套渲染，不新造第五种卡）。
 *
 * ## 与 `level_card` 互斥
 *
 * 「先问意图」和「直接出关」是两条互斥的路径：既然还没问清，这轮就不能出关；
 * 既然出了关，就说明意图已经够了。这条写进 schema 的 `superRefine`，任何一条
 * 路径想两头都要都会在 parse 时炸掉。
 */
export const AgentClarifySchema = z.object({
  /** 只问一个问题（以问号结尾），与 probe_form 的 `question` 一致 */
  question: z.string().min(1),
  /** 2–4 个可点选项；自由作答仍走输入框 */
  options: z.array(z.string().min(1)).min(2).max(4),
  /**
   * 第二组选项：**熟练度自评**（票 84）。
   *
   * 为什么放在同一张卡上而不是再问一轮：目标与自评是同一件事的两半——
   * 「为了考试」配上「完全没学过」和配上「很熟」会导向完全不同的首轮渲染
   * （P1 完整样例 vs P3 直接出题）。拆成两轮要学生多等一次模型往返，
   * 而这两个答案本可以在一屏里同时给出。
   *
   * 为空/缺省表示这张卡只问意图，不要求自评（保持 t79 的行为不变）。
   */
  selfLevelOptions: z.array(z.string().min(1)).min(2).max(4).optional(),

  /** 一句「为什么问这个」——学生要知道这问题有什么用 */
  why: z.string().min(1),
});

export type AgentClarify = z.infer<typeof AgentClarifySchema>;

export const AgentTurnResponseSchema = z
  .object({
  /**
   * 本轮的决策链快照（迁移 0072）。可选：老轮次没有这一列，界面必须能处理缺失，
   * 不能因此把整张卡片判成坏数据。
   * 形状固定四段：skills[] / retrieval{candidates,allowed,used,chunks[]} /
   * decisions{tier,focusNote,retryCount,degraded} / model{name,latencyMs,reasoning}。
   */
  trace: z.record(z.string(), z.unknown()).optional(),
    turnId: z.string(),
    sessionId: z.string(),
    /** 与 errorCard 恰好一个非空 */
    artifact: AgentArtifactSchema.nullable(),
    errorCard: AgentErrorCardSchema.nullable(),
    degraded: z.boolean(),
    /** 解析失败后重试了几次：0 或 1，票 08 只允许重试一次 */
    retryCount: z.number().int().min(0).max(1),
    visibleResponse: z.string(),
    visibleResponseKind: VisibleResponseKindSchema,
    languageCheck: AgentLanguageCheckSchema,
    actions: z.array(AgentCardActionSchema),
    /**
     * 出关卡前的意图确认（票 79）。缺省表示「不需要问」。
     *
     * 用可选字段而不是 `null`：`undefined` 在 JSON 里直接消失，客户端拿到的
     * 对象没有这个键，前端 `clarify ? ... : ...` 的分支就不会被一个 `null`
     * 值提前触发。
     */
    clarify: AgentClarifySchema.optional(),
    createdAt: z.string(),
  })
  .superRefine((value, ctx) => {
    const hasArtifact = value.artifact !== null;
    const hasError = value.errorCard !== null;
    if (hasArtifact === hasError) {
      ctx.addIssue({
        code: 'custom',
        path: ['artifact'],
        message: '产物卡与降级卡必须恰好有一个非空',
      });
    }
    if (hasError && !value.degraded) {
      ctx.addIssue({
        code: 'custom',
        path: ['degraded'],
        message: '出现降级卡时 degraded 必须为 true',
      });
    }
    if (value.clarify && value.artifact?.kind === 'level_card') {
      ctx.addIssue({
        code: 'custom',
        path: ['clarify'],
        message: '问津与出关卡不能同时出现：还没问清意图，就不该出关卡',
      });
    }
    if (value.clarify && value.artifact !== null && value.artifact.kind !== 'probe_form') {
      ctx.addIssue({
        code: 'custom',
        path: ['clarify'],
        message: '问津卡必须伴随一张 probe_form（复用追问卡的渲染，不新造卡种）',
      });
    }
    if (
      value.visibleResponseKind === 'probe_question' &&
      !/[?？]\s*$/.test(value.visibleResponse)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['visibleResponse'],
        message: '标记为追问时 visibleResponse 必须以问号结尾',
      });
    }
  });

/** 学习日志条目：历史是日志，不是消息。 */
export const AgentTurnRecordSchema = z.object({
  turnId: z.string(),
  sessionId: z.string(),
  utterance: z.string(),
  artifactKind: z.enum([
    'level_card',
    'graph_focus',
    'progress_change',
    'probe_form',
    'error_card',
  ]),
  cardTitle: z.string(),
  degraded: z.boolean(),
  createdAt: z.string(),
});

/** GET /api/v1/agent/turns */
export const AgentTurnHistoryResponseSchema = z.object({
  sessionId: z.string(),
  items: z.array(AgentTurnRecordSchema),
  nextCursor: z.string().nullable(),
});

/** GET /api/v1/agent/sessions 里的一行：「学习记录」页左侧的一条会话。 */
export const AgentSessionSummarySchema = z.object({
  sessionId: z.string(),
  /** 会话建立时间；`sessions` 表里旧行可能没有，回落到首轮时间。 */
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  /**
   * 会话里有多少轮。**分母必须来自数据**：0 轮的会话不会出现（它根本没有
   * `agent_turns` 行），所以这里最小是 1。
   */
  turnCount: z.number().int().min(1),
  /**
   * 首句摘要，最多 60 个字符（超出由服务端截断并补 `…`）。取的是 `ordinal`
   * 最小那轮，不是 `created_at` 最早那轮 —— 见 `TurnService.sessions`。
   */
  firstUtterance: z.string(),
  /** 最近一轮的时间，列表按它倒序。 */
  lastActivityAt: z.string(),
});

/** GET /api/v1/agent/sessions */
export const AgentSessionListResponseSchema = z.object({
  sessions: z.array(AgentSessionSummarySchema),
});

/** 「看依据」里的一个切片：是否答案块、是否被门控排除、为什么。 */
export const AgentEvidenceChunkSchema = z.object({
  chunkId: z.string(),
  sourceId: z.string(),
  sourceTitle: z.string(),
  page: z.number().int().nullable(),
  kind: z.enum(['text', 'formula', 'figure', 'table']),
  snippet: z.string(),
  score: z.number(),
  isAnswerChunk: z.boolean(),
  allowed: z.boolean(),
  tier: z.enum(['background', 'scaffold', 'full']),
  /** 被排除时的具体原因；放行时为 null */
  exclusionReason: z.string().nullable(),
});

/** GET /api/v1/agent/turns/:turnId/evidence */
export const AgentTurnEvidenceResponseSchema = z.object({
  turnId: z.string(),
  microKpId: z.string().nullable(),
  gateTier: z.enum(['background', 'scaffold', 'full']),
  items: z.array(AgentEvidenceChunkSchema),
});

/* ------------------------------------------------------------------ *
 * 票 09：检索调试器
 * ------------------------------------------------------------------ */

export const GateTierSchema = z.enum(['background', 'scaffold', 'full']);

export const RetrievalDebugHitSchema = z.object({
  chunkId: z.string(),
  microKpId: z.string().nullable(),
  score: z.number(),
  snippet: z.string(),
  kind: z.enum(['text', 'formula', 'figure', 'table']),
  page: z.number().int().nullable(),
  /**
   * 来源 id（`app.sources.id`）。
   *
   * 只有 `sourceTitle` 时「这条来自哪本书」只能靠标题字符串比对，而标题里有
   * 全角括号、版次、作者顺序 —— 拿它做关联迟早会错。验收要求「每条带
   * `sourceId` 与页码」，调试器与评估都需要能直接 join 内容库。
   */
  sourceId: z.string(),
  sourceTitle: z.string(),
  /** 对**当前知识点**而言是否答案块——同一 chunk 换个知识点会翻转 */
  isAnswerChunk: z.boolean(),
  allowed: z.boolean(),
  tier: GateTierSchema,
  exclusionReason: z.string().nullable(),
});

/**
 * 一条跨语言展开记录（t32）：中文 query 里的术语 → 它展开出的英文串。
 *
 * 调试器要回答的问题是「一句纯中文的提问，为什么命中了英文正文」。
 * 没有这条信息时，看到 `sourceTitle: Knoll` 只能靠猜。
 */
export const RetrievalExpansionSchema = z.object({
  /** 命中的中文术语（来自 `content/glossary.json`） */
  zh: z.string(),
  /** 由它展开出的英文串 */
  en: z.string(),
});

/** GET /api/v1/agent/retrieval/debug */
export const RetrievalDebugResponseSchema = z.object({
  query: z.string(),
  microKpId: z.string(),
  /** 当前掌握度；null 表示证据不足，按最保守档处理 */
  current: z.number().min(0).max(1).nullable(),
  gateTier: GateTierSchema,
  hits: z.array(RetrievalDebugHitSchema),
  /** BM25 命中的总数（未截断） */
  totalMatched: z.number().int().min(0),
  answerChunkCount: z.number().int().min(0),
  excludedCount: z.number().int().min(0),
  /**
   * 跨语言扩展记录。空数组表示这次检索没有用到术语表
   * （纯英文 query，或中文 query 没命中任何术语）。
   *
   * **不是可选字段**：可选会让前端写 `expansions?.length` 而把「没有扩展」
   * 与「老后端」混为一谈。旧客户端拿到多出来的字段不会坏（HTTP JSON 向后兼容），
   * 但新客户端不该猜。
   */
  expansions: z.array(RetrievalExpansionSchema),
  /**
   * 语义重排（t82）这次是否参与、重排了几条。
   *
   * **不是可选字段**，理由同 `expansions`：可选会让「没接语义」与「老后端」
   * 混为一谈。`reranked: 0` 且 `enabled: true` 是合法状态（候选为空，或向量库
   * 里一条都对不上），与 `enabled: false` 是两件事。
   */
  semantic: z.object({
    enabled: z.boolean(),
    /** 未参与时的具体原因（人话）；参与时为 null */
    reason: z.string().nullable(),
    /** 被向量分改变了名次的条数 */
    reranked: z.number().int().min(0),
  }),
});

export const RetrievalBandSchema = z.object({
  current: z.number().min(0).max(1),
  gateTier: GateTierSchema,
  allowedIds: z.array(z.string()),
  excludedIds: z.array(z.string()),
});

/**
 * GET /api/v1/agent/retrieval/bands
 *
 * 同一个 query 在三个 current 下的集合对比。票 09 要求「差异恰好等于答案块
 * 集合」可被直接断言——把三档结果一次返回，前端和测试都不用自己跑三遍。
 */
export const RetrievalBandsResponseSchema = z.object({
  query: z.string(),
  microKpId: z.string(),
  answerChunkIds: z.array(z.string()),
  bands: z.array(RetrievalBandSchema),
  /** 同 `RetrievalDebugResponse.expansions`：三档共用同一批扩展词 */
  expansions: z.array(RetrievalExpansionSchema),
});

/* ------------------------------------------------------------------ *
 * 票 10：苏格拉底追问状态机
 * ------------------------------------------------------------------ */

export const ProbeReplyKindSchema = z.enum([
  'correct',
  'partial',
  'wrong',
  'dont_know',
  'give_up',
  'frustration',
]);

export const ProbeActionKindSchema = z.enum([
  'acknowledge',
  'hint',
  'probe_deeper',
  'reteach',
  'reveal',
  'exit',
]);

/** 阶梯状态的对外快照。两个失败计数器分开暴露，前端要能分别解释。 */
export const ProbeLadderSnapshotSchema = z.object({
  level: z.number().int().min(0).max(5),
  cap: z.number().int().min(1).max(5),
  maxLevelUsed: z.number().int().min(0).max(5),
  consecutiveUnknown: z.number().int().min(0),
  consecutiveWrong: z.number().int().min(0),
  noProgress: z.number().int().min(0),
  exited: z.boolean(),
});

/**
 * 独立 judge 的结论。
 *
 * 按**拒绝原因**分类，而不是给一个总通过率：spec §6 明确说越界判定要看
 * 「为什么判越界」，因为过度拒绝（把诚实求助当越界）比帮助不足危害更大。
 */
export const ProbeRejectReasonSchema = z.enum([
  'leaks_final_value',
  'leaks_formula',
  'reveals_answer',
  'multiple_questions',
  'probe_without_question',
]);

export const ProbeJudgeVerdictSchema = z.object({
  passed: z.boolean(),
  reasons: z.array(ProbeRejectReasonSchema),
  /** 本轮回复里出现了几个问号——票 10 要求每轮只问一个问题 */
  questionCount: z.number().int().min(0),
});

/** POST /api/v1/agent/probes */
export const ProbeStartRequestSchema = z.object({
  microKpId: z.string().min(1),
  tier: LearnerTierSchema.default('P1'),
});

/** POST /api/v1/agent/probes/:probeId/replies */
export const ProbeReplyRequestSchema = z.object({
  replyText: z.string().min(1).max(2000),
});

export const ProbeTurnResponseSchema = z.object({
  probeId: z.string(),
  microKpId: z.string(),
  tier: LearnerTierSchema,
  /** 学生这句被判定成什么 */
  replyKind: ProbeReplyKindSchema,
  /** 状态机决定下一步做什么 */
  action: ProbeActionKindSchema,
  /** 动作的原因（reteach 时是 repeated_unknown / repeated_wrong / frustration 等） */
  actionReason: z.string().nullable(),
  /** 本轮要展示给学生的那句话；退出追问时为 null */
  question: z.string().nullable(),
  ladder: ProbeLadderSnapshotSchema,
  /**
   * 对**模型这一轮原始措辞**的越界判定，不是兜底后的。
   *
   * 若判的是兜底后问句，`passed` 永远为 true、metrics 的越界率恒等于 0，
   * 票 10 要求的「泄露最终数值／公式的回复占比可测量」就形同虚设。
   */
  judge: ProbeJudgeVerdictSchema,
  /**
   * 本轮是否发生了「越界 → 退回骨架问句」。
   *
   * 不能靠 `judge.passed === false` 反推：那说明的是「模型越界了」，
   * 而这一位说明的是「你看到的那句话不是模型写的」。两者在排查时
   * 指向完全不同的地方。
   */
  fallbackApplied: z.boolean(),
  createdAt: z.string(),
});

/** GET /api/v1/agent/probes/:probeId */
export const ProbeSessionResponseSchema = z.object({
  probeId: z.string(),
  microKpId: z.string(),
  tier: LearnerTierSchema,
  ladder: ProbeLadderSnapshotSchema,
  turns: z.number().int().min(0),
  /** 已问过的问题，用于验证「降级后换动作而非重复同一问题」 */
  askedQuestions: z.array(z.string()),
});

/** GET /api/v1/agent/probes/metrics */
export const ProbeMetricsResponseSchema = z.object({
  turns: z.number().int().min(0),
  violations: z.number().int().min(0),
  /** 越界回复占比。0 与「没有数据」不同，前端需要 turns 才能区分。 */
  violationRate: z.number().min(0).max(1),
  reasonCounts: z.record(z.string(), z.number().int().min(0)),
});

/* ------------------------------------------------------------------ *
 * 票 15：skill 库
 * ------------------------------------------------------------------ */

export const SkillReferenceSchema = z.object({
  name: z.string(),
  sizeBytes: z.number().int().min(0),
  /** 前若干行，够判断「这份参考值不值得展开」 */
  preview: z.string(),
});

export const SkillSummarySchema = z.object({
  /** 必须等于目录名，≤64 字符，仅小写字母数字连字符 */
  name: z.string(),
  description: z.string(),
  version: z.string(),
  /** 触发场景：SKILL.md frontmatter 或正文里的使用时机 */
  triggerScenarios: z.array(z.string()),
  enabled: z.boolean(),
  referenceCount: z.number().int().min(0),
  directoryName: z.string(),
});

/** GET /api/v1/agent/skills */
export const SkillListResponseSchema = z.object({
  /** 被扫描的目录（绝对路径），页面上要显示，方便说明「迁移靠文件系统」 */
  directory: z.string(),
  items: z.array(SkillSummarySchema),
  enabledCount: z.number().int().min(0),
  disabledCount: z.number().int().min(0),
});

export const SkillDetailSchema = SkillSummarySchema.extend({
  instructions: z.string(),
  references: z.array(SkillReferenceSchema),
  validation: z.object({
    valid: z.boolean(),
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
});

/** GET /api/v1/agent/skills/:name */
export const SkillDetailResponseSchema = z.object({
  skill: SkillDetailSchema,
});

/** PATCH /api/v1/agent/skills/:name */
export const SkillToggleRequestSchema = z.object({
  enabled: z.boolean(),
});

/**
 * GET /api/v1/agent/skills/system-preview
 *
 * 返回「如果此刻启动 agent，system message 里会出现哪些 skill」。
 * 禁用必须真的把 skill 从这份清单里摘掉——不是加一句「别用它」。
 */
export const SkillSystemPreviewResponseSchema = z.object({
  systemMessage: z.string(),
  includedSkills: z.array(z.string()),
  excludedSkills: z.array(z.string()),
});

export type LearnerTier = z.infer<typeof LearnerTierSchema>;
export type AgentCardAction = z.infer<typeof AgentCardActionSchema>;
export type LevelCardArtifact = z.infer<typeof LevelCardArtifactSchema>;
export type GraphFocusArtifact = z.infer<typeof GraphFocusArtifactSchema>;
export type ProgressChangeArtifact = z.infer<typeof ProgressChangeArtifactSchema>;
export type ProbeFormArtifact = z.infer<typeof ProbeFormArtifactSchema>;
export type AgentArtifact = z.infer<typeof AgentArtifactSchema>;
export type AgentArtifactKind = z.infer<typeof AgentArtifactKindSchema>;
export type AgentErrorCard = z.infer<typeof AgentErrorCardSchema>;
export type AgentLanguageCheck = z.infer<typeof AgentLanguageCheckSchema>;
export type VisibleResponseKind = z.infer<typeof VisibleResponseKindSchema>;
export type AgentTurnRequest = z.infer<typeof AgentTurnRequestSchema>;
export type AgentTurnResponse = z.infer<typeof AgentTurnResponseSchema>;
export type AgentTurnRecord = z.infer<typeof AgentTurnRecordSchema>;
export type AgentTurnHistoryResponse = z.infer<typeof AgentTurnHistoryResponseSchema>;
export type AgentSessionSummary = z.infer<typeof AgentSessionSummarySchema>;
export type AgentSessionListResponse = z.infer<typeof AgentSessionListResponseSchema>;
export type AgentEvidenceChunk = z.infer<typeof AgentEvidenceChunkSchema>;
export type AgentTurnEvidenceResponse = z.infer<typeof AgentTurnEvidenceResponseSchema>;
export type GateTierName = z.infer<typeof GateTierSchema>;
export type RetrievalDebugHit = z.infer<typeof RetrievalDebugHitSchema>;
export type RetrievalExpansion = z.infer<typeof RetrievalExpansionSchema>;
export type RetrievalDebugResponse = z.infer<typeof RetrievalDebugResponseSchema>;
export type RetrievalBand = z.infer<typeof RetrievalBandSchema>;
export type RetrievalBandsResponse = z.infer<typeof RetrievalBandsResponseSchema>;
export type ProbeReplyKindName = z.infer<typeof ProbeReplyKindSchema>;
export type ProbeActionKindName = z.infer<typeof ProbeActionKindSchema>;
export type ProbeLadderSnapshot = z.infer<typeof ProbeLadderSnapshotSchema>;
export type ProbeRejectReasonName = z.infer<typeof ProbeRejectReasonSchema>;
export type ProbeJudgeVerdict = z.infer<typeof ProbeJudgeVerdictSchema>;
export type ProbeStartRequest = z.infer<typeof ProbeStartRequestSchema>;
export type ProbeReplyRequest = z.infer<typeof ProbeReplyRequestSchema>;
export type ProbeTurnResponse = z.infer<typeof ProbeTurnResponseSchema>;
export type ProbeSessionResponse = z.infer<typeof ProbeSessionResponseSchema>;
export type ProbeMetricsResponse = z.infer<typeof ProbeMetricsResponseSchema>;
export type SkillReference = z.infer<typeof SkillReferenceSchema>;
export type SkillSummary = z.infer<typeof SkillSummarySchema>;
export type SkillListResponse = z.infer<typeof SkillListResponseSchema>;
export type SkillDetail = z.infer<typeof SkillDetailSchema>;
export type SkillDetailResponse = z.infer<typeof SkillDetailResponseSchema>;
export type SkillToggleRequest = z.infer<typeof SkillToggleRequestSchema>;
export type SkillSystemPreviewResponse = z.infer<typeof SkillSystemPreviewResponseSchema>;
