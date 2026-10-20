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

export const AgentTurnResponseSchema = z
  .object({
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
  sourceTitle: z.string(),
  /** 对**当前知识点**而言是否答案块——同一 chunk 换个知识点会翻转 */
  isAnswerChunk: z.boolean(),
  allowed: z.boolean(),
  tier: GateTierSchema,
  exclusionReason: z.string().nullable(),
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
  judge: ProbeJudgeVerdictSchema,
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
export type AgentEvidenceChunk = z.infer<typeof AgentEvidenceChunkSchema>;
export type AgentTurnEvidenceResponse = z.infer<typeof AgentTurnEvidenceResponseSchema>;
export type GateTierName = z.infer<typeof GateTierSchema>;
export type RetrievalDebugHit = z.infer<typeof RetrievalDebugHitSchema>;
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
