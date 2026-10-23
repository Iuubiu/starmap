import { randomUUID, createHash } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import {
  AgentArtifactKindSchema,
  AgentTurnHistoryResponseSchema,
  AgentSessionListResponseSchema,
  AgentTurnResponseSchema,
  AgentTurnEvidenceResponseSchema,
  type AgentArtifact,
  type AgentArtifactKind,
  type AgentCardAction,
  type AgentClarify,
  type AgentErrorCard,
  type AgentLanguageCheck,
  type AgentTurnEvidenceResponse,
  type AgentTurnHistoryResponse,
  type AgentSessionListResponse,
  type AgentTurnRequest,
  type AgentTurnResponse,
  type LearnerTier,
  type VisibleResponseKind,
} from '@starmap/api-contract';
import { checkChinese, checkProbeForm } from '@starmap/engine';
import { DatabaseService } from '../db/database.service.js';
import { LLM_PORT, type LlmPort, type LlmMessage } from '../llm/llm.port.js';
import { completeStreamingWith, type TurnStreamHooks } from './streaming.js';
import { RetrievalService, type GatedChunk } from '../retrieval/retrieval.service.js';
import { SkillsService } from '../skills/skills.service.js';
import { ProbeService } from '../probe/probe.service.js';
import { RecommendService } from '../recommend/recommend.service.js';
import { matchFocus, type FocusCandidate } from './focus-matcher.js';
import {
  defaultActions,
  formatIssues,
  hydrateArtifact,
  parseArtifact,
  stripInternalFields,
} from './artifact.js';

/**
 * 结构化回合的主体（票 08）。
 *
 * ## 谁决定什么
 *
 * 这一层里有一条刻意的分工线，越过去就会出问题：
 *
 * | 决定 | 谁做 |
 * | --- | --- |
 * | 这轮说哪句话（`visibleResponse`） | 模型 |
 * | 这轮出哪一类卡（`cardKind`） | 模型 |
 * | 卡里的**事实**（关卡 id、题数、掌握度、邻居） | 服务端查库 |
 *
 * 模型不产事实。让它填 `levelId` / `itemCount` / `before.achieved`，它一定会
 * 编——而这些数字是要被学生当真的。所以模型只给「意图 + 措辞」，卡片骨架由
 * 这一层用真实数据渲染。这样即使模型整轮胡说，卡上显示的掌握度也不会错。
 *
 * ## 失败三级
 *
 * 1. 模型第一次给出的 JSON 不合法 → **重试一次**（附修复指令）；
 * 2. 第二次仍不合法 → **降级卡**（可读中文 + 可重试 + debugId），不白屏；
 * 3. 上游抛错（超时/503）→ 同样走降级卡，`retryCount` 记 0。
 *
 * 降级卡**不落模型原文**：原文可能含答案，而学生此刻还没答出来。
 */

/** 模型实际被要求输出的形状。刻意比产物卡窄——见文件头的分工表。 */
const PlanSchema = z.object({
  visibleResponse: z.string().min(1).max(1200),
  cardKind: AgentArtifactKindSchema,
  rationale: z.string().min(1).max(400),
  /** 想聚焦到哪个知识点；缺省用请求里的 */
  microKpId: z.string().nullable().optional(),
  /** probe_form 用：这轮问的问题 */
  question: z.string().max(400).optional(),
  inputKind: z.enum(['free_text', 'choice']).optional(),
  choices: z.array(z.string()).max(8).optional(),
});

type Plan = z.infer<typeof PlanSchema>;

/** 交给 LlmPort 的 JSON Schema（response_format: json_object + 结构提示）。 */
const PLAN_JSON_SCHEMA = {
  type: 'object',
  properties: {
    visibleResponse: { type: 'string' },
    cardKind: {
      type: 'string',
      enum: ['level_card', 'graph_focus', 'progress_change', 'probe_form'],
    },
    rationale: { type: 'string' },
    microKpId: { type: ['string', 'null'] },
    question: { type: 'string' },
    inputKind: { type: 'string', enum: ['free_text', 'choice'] },
    choices: { type: 'array', items: { type: 'string' } },
  },
  required: ['visibleResponse', 'cardKind', 'rationale'],
};

/** 「请重新输出」这句话同时是重试指令与脚本化假模型的匹配锚点（测试要用）。 */
const REPAIR_INSTRUCTION = [
  '上一次的输出不是可用的 JSON。请重新输出，只输出一个 JSON 对象，不要任何解释、不要代码围栏。',
  '必须包含字段：visibleResponse（简体中文，一句话）、cardKind（level_card / graph_focus / progress_change / probe_form 之一）、rationale（中文，一句话说明为什么给这张卡）。',
].join('\n');

/* ────────────────────────────────────────────────────────────────────────
 * 票 79「问津」：出关卡之前先确认学习意图
 *
 * ## 为什么判定要写成纯函数
 *
 * 「什么时候该先问一句」是这个功能里唯一真正会出错的判断：问早了像盘问，
 * 问晚了就又变成「听你说个名词就出关」。把它写成不依赖数据库、不依赖模型的
 * 函数，才能用表驱动测试把边界钉住（见 `ask-the-way.test.ts`）。
 *
 * ## 三条判定规则（与 SKILL.md 正文一致，改一处必须改另一处）
 *
 * 1. 话里已经有**目标词**（考试 / 论文 / 作业 / 补基础 …）→ 不问，直接出关；
 * 2. 学生说「别问了 / 直接开始」→ 尊重，直接出关，意图记 `unspecified`；
 * 3. 只报了一个宽泛名词（"我想学布尔代数"）→ 问一轮，选项即四个常见目的。
 *
 * 已经问过一次（`askTheWay.askedAt` 存在）时，下一句就是答案：解析成意图写回
 * 会话，不再追问 —— 这就是「1–2 问」里的第二问。
 * ──────────────────────────────────────────────────────────────────────── */

export const ASK_THE_WAY_QUESTION = '这一轮，你更想为了什么？';

export const ASK_THE_WAY_WHY =
  '先问一句，免得我按错的深度出题——选完我立刻给关卡。';

export const ASK_THE_WAY_OPTIONS = [
  '为了解题',
  '为了看懂论文或教材',
  '为了补基础',
  '为了考试',
] as const;

/** 落库的目标枚举。`unspecified` 是「学生明确说别问了」，不是「没问」。 */
export type IntentGoal =
  | 'solve_problem'
  | 'read_paper'
  | 'foundation'
  | 'exam'
  | 'unspecified';


export interface IntentRecord {
  goal: IntentGoal;
  /** 想先做题（true）/ 先看讲解（false）/ 没说（null） */
  preferPractice: boolean | null;
  /** 熟练度自评（票 84）：没说或说不清都是 null —— 不猜。 */
  selfLevel: SelfLevel | null;
  resolvedAt: string;
}

export type IntentStep =
  | { kind: 'none' }
  | { kind: 'ask' }
  | {
      kind: 'resolve';
      goal: IntentGoal;
      preferPractice: boolean | null;
      /** 为什么这轮不问 —— 只用于日志，不进响应 */
      via: 'goal_word' | 'skip' | 'clarify_answer';
    };

const GOAL_PATTERNS: ReadonlyArray<{ goal: IntentGoal; pattern: RegExp }> = [
  { goal: 'exam', pattern: /考试|期末|期中|考研|测验|考数电|大考|补考/ },
  { goal: 'solve_problem', pattern: /解题|做题|作业|习题|算一|算题|这道题|刷题/ },
  { goal: 'read_paper', pattern: /论文|文献|教材|看懂|读懂|读论文/ },
  { goal: 'foundation', pattern: /补基础|打基础|基础差|从头学|补一补|基础不牢/ },
];

/** 「别问了，直接开始」的几种说法。刻意宽一点：拒绝被盘问是合理诉求。 */
const SKIP_PATTERNS: readonly RegExp[] = [
  /别问了/,
  /不用问/,
  /不问了/,
  /别问/,
  /直接开始/,
  /直接出/,
  /直接给/,
  /开始吧/,
  /少废话/,
  /别啰嗦/,
];

/** 明确的学习请求：只有这类话才值得先问一轮意图。
 *
 * 判据必须比「提到一个名词」更窄，否则每一轮都会先弹追问：一个正在做题的学生
 * 说「这个电路怎么算」「前置放大器的噪声来源」，都不是在请求「入门」，打断他们
 * 是纯粹的骚扰。票面要的是「只说宽泛名词 → 先问」，而现实里「宽泛名词」总是
 * 裹在某种学习请求里（我想学 X / 讲讲 X / 带我了解一下 X）。
 */
const LEARN_REQUEST_PATTERN =
  /想学|想了解|想入门|想搞懂|想弄懂|想掌握|学一下|了解一下|教我|讲讲|介绍一下|带我学/;

const PRACTICE_FIRST = /先做题|先做点题|先练|直接做题|给我题/;
const EXPLAIN_FIRST = /先讲|先看讲解|先看解释|讲一讲|先解释|先看视频/;

/** 「为了什么」：命中目标词就返回意图，否则 null（= 需要问）。 */
export function classifyIntentGoal(utterance: string): IntentGoal | null {
  const text = utterance.trim();
  for (const rule of GOAL_PATTERNS) {
    if (rule.pattern.test(text)) return rule.goal;
  }
  return null;
}

/** 学生是否明确表示「别问了」。 */
export function saysSkipClarify(utterance: string): boolean {
  const text = utterance.trim();
  return SKIP_PATTERNS.some((pattern) => pattern.test(text));
}

/** 「先做题还是先看讲解」：说了就返回，没说返回 null。 */
export function classifyPracticePreference(utterance: string): boolean | null {
  const text = utterance.trim();
  if (PRACTICE_FIRST.test(text)) return true;
  if (EXPLAIN_FIRST.test(text)) return false;
  return null;
}

/**
 * 熟练度自评的四档（票 84）。学生报的是「我感觉自己什么水平」，
 * 不是内部档位代号 —— 所以存的是这四个词，再由 `selfLevelToTier` 翻译成 P1/P2/P3。
 */
export type SelfLevel = 'none' | 'seen' | 'slow' | 'fluent';

const SELF_LEVEL_PATTERNS: { pattern: RegExp; level: SelfLevel }[] = [
  { pattern: /完全没学过|没接触过|零基础|从没学过/, level: 'none' },
  { pattern: /见过.{0,4}不会用|看得懂.{0,4}做不出|不会用/, level: 'seen' },
  { pattern: /会做但慢|做得慢|不太熟/, level: 'slow' },
  { pattern: /很熟|比较熟|已经很熟|熟练/, level: 'fluent' },
];

/** 解析自评；说不清就返回 null（不猜）。顺序即优先级：先说「没见过」最容易被后文覆盖。 */
export function classifySelfLevel(utterance: string): SelfLevel | null {
  const text = utterance.trim();
  for (const rule of SELF_LEVEL_PATTERNS) {
    if (rule.pattern.test(text)) return rule.level;
  }
  return null;
}

/**
 * 自评 → 首轮渲染档位。
 *
 * 冲突时**以服务端实测为准**（`placement_profile`），这里只回答「没有实测时按自评给哪档」：
 * 完全没学过 → P1（完整样例）；见过但不会用 → P1（仍需样例，但可略讲）；
 * 会做但慢 → P2；很熟 → P3（直接出题）。返回 null 表示「不做判断」，交回既有逻辑。
 */
export function selfLevelToTier(level: SelfLevel | null): 'P1' | 'P2' | 'P3' | null {
  if (level === 'none' || level === 'seen') return 'P1';
  if (level === 'slow') return 'P2';
  if (level === 'fluent') return 'P3';
  return null;
}

/** 从 `sessions.meta` 里取出已确立的意图（形状不对就当没有）。 */export function readIntent(meta: Record<string, unknown>): IntentRecord | null {
  const raw = meta.intent;
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Partial<IntentRecord>;
  const goal = record.goal;
  if (
    goal !== 'solve_problem' &&
    goal !== 'read_paper' &&
    goal !== 'foundation' &&
    goal !== 'exam' &&
    goal !== 'unspecified'
  ) {
    return null;
  }
  return {
    goal,
    preferPractice: typeof record.preferPractice === 'boolean' ? record.preferPractice : null,
    selfLevel:
      record.selfLevel === 'none' ||
      record.selfLevel === 'seen' ||
      record.selfLevel === 'slow' ||
      record.selfLevel === 'fluent'
        ? record.selfLevel
        : null,
    resolvedAt: typeof record.resolvedAt === 'string' ? record.resolvedAt : '',
  };
}

/** 已经问过一次没有（`askTheWay.askedAt`）。 */
export function hasAskedTheWay(meta: Record<string, unknown>): boolean {
  const raw = meta.askTheWay;
  return !!raw && typeof raw === 'object' && typeof (raw as { askedAt?: unknown }).askedAt === 'string';
}

/**
 * 这一轮该怎么处理意图：不问 / 问一句 / 直接定下来。
 *
 * 纯函数：入参只有话、焦点与两个会话标记，没有 IO、没有时钟（`resolvedAt`
 * 由调用方写）。顺序本身就是规则：
 *
 * 1. 意图已定 → 不问（也不覆盖：学生的第一句话就是他的目标，后面聊技术细节
 *    不该把目标改写掉）；
 * 2. 「别问了」→ 定成 `unspecified` 放行 —— 尊重学生比补全一条画像重要；
 * 3. 问过一次 → 这句就是答案，解析后放行（第二问结束）；
 * 4. 目标词命中 → 放行；
 * 5. 没有焦点 → 不问（连「为谁问」都不知道，问了像空转）；
 * 6. 其余 → 问一句。
 */
export function resolveIntentStep(input: {
  utterance: string;
  microKpId: string | null;
  intent: IntentRecord | null;
  askedBefore: boolean;
}): IntentStep {
  const { utterance, microKpId, intent, askedBefore } = input;
  if (intent) return { kind: 'none' };

  if (saysSkipClarify(utterance)) {
    return {
      kind: 'resolve',
      goal: classifyIntentGoal(utterance) ?? 'unspecified',
      preferPractice: classifyPracticePreference(utterance),
      via: 'skip',
    };
  }

  if (askedBefore) {
    return {
      kind: 'resolve',
      goal: classifyIntentGoal(utterance) ?? 'unspecified',
      preferPractice: classifyPracticePreference(utterance),
      via: 'clarify_answer',
    };
  }

  const goal = classifyIntentGoal(utterance);
  if (goal) {
    return {
      kind: 'resolve',
      goal,
      preferPractice: classifyPracticePreference(utterance),
      via: 'goal_word',
    };
  }

  if (!microKpId) return { kind: 'none' };

  // 不是「我想学……」这类请求，就别打断原有流程。
  if (!LEARN_REQUEST_PATTERN.test(utterance)) return { kind: 'none' };

  return { kind: 'ask' };
}

const MAX_EVIDENCE_ROWS = 8;

@Injectable()
export class TurnService {
  private readonly logger = new Logger('AgentTurn');

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(RetrievalService) private readonly retrieval: RetrievalService,
    @Inject(SkillsService) private readonly skills: SkillsService,
    @Inject(ProbeService) private readonly probe: ProbeService,
    @Inject(LLM_PORT) private readonly llm: LlmPort,
  ) {}

  /* ---------------------------------------------------------------- *
   * 读库：卡片里的事实
   * ---------------------------------------------------------------- */

  /**
   * 没有显式选定知识点时，服务端替学习者挑一个焦点。
   *
   * 为什么不让模型挑：模型不知道谁学过什么、哪个点现在最值得学，它只能
   * 编一个名字出来。为什么不在前端挑：换一个客户端（CLI、其它前端）就不
   * 该需要先知道「看板怎么算推荐」。推荐算法的唯一实现在
   * `apps/api/src/recommend/recommend.service.ts`，这里只取它的第一个。
   *
   * 返回值里的 `note` 会写进提示词，让模型知道这个点不是学习者选的 ——
   * 否则它会把「你刚才说的」安到学习者头上。
   */
  private async resolveFocus(
    sessionId: string,
    microKpId: string | null,
    utterance: string,
  ): Promise<{
    microKpId: string | null;
    name: string | null;
    note: string | null;
  }> {
    if (microKpId) {
      return { microKpId, name: await this.kpName(microKpId), note: null };
    }

    // 先听学习者说了什么（t56）。
    //
    // 顺序不能反：推荐是「按你的历史进度猜」，而学习者刚刚明说了想学什么。
    // 先推荐再匹配，等于把学生的话当补充信息，实测结果是连说十句不同主题都拿到
    // 同一张卡（推荐列表全库第一条固定）。匹配是确定性的字符串比较，没有模型
    // 参与，也没有额外网络往返。
    const matched = await this.matchUtterance(utterance);
    if (matched) {
      this.logger.log(
        `未选定知识点，按学习者原话匹配到：${matched.microKpId}（${matched.name}；命中「${matched.matchedText}」）`,
      );
      return {
        microKpId: matched.microKpId,
        name: matched.name,
        note: `（这个点是学习者刚才那句话里提到的「${matched.matchedText}」，服务端按知识点名字匹配到的。）`,
      };
    }

    try {
      const recommend = new RecommendService(this.db);
      const { recommendedIds } = await recommend.graphData(await recommend.now());
      if (recommendedIds.length === 0) return { microKpId: null, name: null, note: null };

      // 同一会话内轮换，而不是每轮都取第一个。
      //
      // 推荐列表默认只有 `RECOMMEND_DEFAULT_LIMIT`（3）个，恒取第一个会让整段
      // 对话的焦点钉死在一个知识点上：学生连说十句话，十张卡讲的是同一件事，
      // 这和占位卡一样没有推进。
      //
      // 选法：**最久没用过的那个**（从没用过的优先）。不用「取第一个没用过的」
      // ——那样用完 3 个之后就永久钉在第 1 个上（实测第 4–10 轮全是同一个点）。
      // 用「上次用它的轮次」排序就是轮转 1→2→3→1→…，每一轮都换。
      // 仍不引入新算法：候选集合、顺序语义都来自 `recommend()`，这里只决定
      // 「这一轮从它的输出里取哪一个」。
      const lastUsed = await this.lastFocusOrdinals(sessionId);
      const picked = [...recommendedIds].sort(
        (a, b) => (lastUsed.get(a) ?? 0) - (lastUsed.get(b) ?? 0),
      )[0];
      if (!picked) return { microKpId: null, name: null, note: null };
      const name = await this.kpName(picked);
      this.logger.log(
        `未选定知识点，按推荐挑焦点：${picked}（${name ?? '无名'}；本会话已用过 ${lastUsed.size} 个）`,
      );
      return {
        microKpId: picked,
        name,
        note: `（这个点是服务端按你当前进度挑的推荐，不是你刚说的；要换请在知识地图上选。）`,
      };
    } catch (error) {
      // 推荐算不出来不该让整轮失败：退回到「请先选一个点」，与旧行为一致。
      this.logger.warn(
        `推荐失败，本轮无焦点：${error instanceof Error ? error.message : String(error)}`,
      );
      return { microKpId: null, name: null, note: null };
    }
  }

  /**
   * 把学习者这句话对到某个知识点上；对不上返回 null（调用方回落到推荐）。
   *
   * 每次现查 4030 个知识点的名字：这条查询 ~5ms，而加缓存会引入「知识点改名后
   * 匹配表是旧的」这类静默故障 —— 匹配错了比慢一点难查得多。
   */
  private async matchUtterance(utterance: string): Promise<ReturnType<typeof matchFocus>> {
    try {
      const rows = await this.db.query<{
        id: string;
        name: string;
        is_leaf: boolean;
        depth: number | string;
      }>('SELECT id, name, is_leaf, depth FROM knowledge_points');
      const candidates: FocusCandidate[] = rows.map((row) => ({
        microKpId: row.id,
        name: row.name,
        isLeaf: row.is_leaf,
        depth: Number(row.depth),
      }));
      return matchFocus(utterance, candidates);
    } catch (error) {
      // 匹配失败不该让整轮失败：退回推荐即可，学习者仍然拿到一张卡。
      this.logger.warn(
        `按原话匹配知识点失败，回落到推荐：${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async ensureSession(sessionId: string): Promise<void> {
    // 前端不必先建会话：没有会话时回合无处可落（agent_turns 有外键）。
    await this.db.query('INSERT INTO sessions (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [
      sessionId,
    ]);
  }

  /**
   * 本会话里每个焦点**最后一次**被用到的轮次（ordinal）。
   *
   * 只读 `agent_turns.micro_kp_id`：那是**实际落卡的**焦点，不是「打算用的」。
   * 失败的回合也会写一行（降级卡），它的 micro_kp_id 同样记着当轮焦点，所以
   * 学生看到过的东西不会被下一轮当成「从没提过」重新端上来。
   *
   * 返回的是 ordinal 而不是布尔：轮换要的是「谁最久没用过」，只记用没用过
   * 会让候选用尽后永久钉在第一个上。
   */
  private async lastFocusOrdinals(sessionId: string): Promise<Map<string, number>> {
    const rows = await this.db.query<{ micro_kp_id: string; last_ordinal: number | string }>(
      `SELECT micro_kp_id, max(ordinal) AS last_ordinal
         FROM agent_turns
        WHERE session_id = $1 AND micro_kp_id IS NOT NULL
        GROUP BY micro_kp_id`,
      [sessionId],
    );
    return new Map(rows.map((row) => [row.micro_kp_id, Number(row.last_ordinal)]));
  }

  /** 知识点是否存在（模型给的外部 id 必须过这一关才能进卡）。 */
  private async knowledgePointExists(microKpId: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      'SELECT id FROM knowledge_points WHERE id = $1',
      [microKpId],
    );
    return rows.length > 0;
  }

  private async nextOrdinal(sessionId: string): Promise<number> {
    const rows = await this.db.query<{ next: number }>(
      'SELECT COALESCE(MAX(ordinal), 0) + 1 AS next FROM agent_turns WHERE session_id = $1',
      [sessionId],
    );
    return Number(rows[0]?.next ?? 1);
  }

  /**
   * 会话起始时的掌握度快照。
   *
   * 「进度变化」卡必须有 before。before 不能凭空取当前值（那就是「没变化」），
   * 所以要有一个**早于此刻**的锚。放在 `sessions.meta` 而不是新表：它是会话的
   * 附属数据，会话结束就没意义了。
   */
  private async sessionStartMastery(
    sessionId: string,
    microKpId: string,
  ): Promise<{ achieved: number; current: number; state: string } | null> {
    const rows = await this.db.query<{ meta: Record<string, unknown> | null }>(
      'SELECT meta FROM sessions WHERE id = $1',
      [sessionId],
    );
    const meta = rows[0]?.meta ?? {};
    const snapshots = (meta.masterySnapshot ?? {}) as Record<string, unknown>;
    const existing = snapshots[microKpId];
    if (existing && typeof existing === 'object') {
      return existing as { achieved: number; current: number; state: string };
    }

    // 第一次碰到这个知识点：此刻的掌握度就是「起点」。
    const live = await this.currentMastery(microKpId);
    if (!live) return null;

    await this.db.query(
      `UPDATE sessions
          SET meta = jsonb_set(
                COALESCE(meta, '{}'::jsonb),
                '{masterySnapshot}',
                COALESCE(meta->'masterySnapshot', '{}'::jsonb) || jsonb_build_object($2, $3::jsonb)
              )
        WHERE id = $1`,
      [sessionId, microKpId, JSON.stringify(live)],
    );
    return live;
  }

  private async currentMastery(
    microKpId: string,
  ): Promise<{ achieved: number; current: number; state: string } | null> {
    const rows = await this.db.query<{
      achieved: string;
      current: string;
      state: string;
    }>('SELECT achieved::text AS achieved, current::text AS current, state FROM mastery WHERE micro_kp_id = $1', [
      microKpId,
    ]);
    const row = rows[0];
    if (!row) return null;
    return {
      achieved: Number(row.achieved),
      current: Number(row.current),
      state: row.state,
    };
  }

  /** 该知识点下的关卡（若有）。关卡卡的事实来源。 */
  private async levelFact(microKpId: string): Promise<{
    levelId: string;
    title: string;
    itemCount: number;
    firstStepKind: string;
    estimatedMinutes: number;
  } | null> {
    const rows = await this.db.query<{
      id: string;
      title: string;
      spec: Record<string, unknown> | null;
      item_count: string;
    }>(
      `SELECT l.id, l.title, l.spec, count(li.id)::text AS item_count
         FROM levels l
         LEFT JOIN level_items li ON li.level_id = l.id
        WHERE l.micro_kp_id = $1
        GROUP BY l.id, l.ordinal
        ORDER BY l.ordinal
        LIMIT 1`,
      [microKpId],
    );
    const row = rows[0];
    if (!row) return null;

    const spec = row.spec ?? {};
    const steps = Array.isArray(spec.steps) ? (spec.steps as Array<Record<string, unknown>>) : [];
    const rawFirstStep = steps[0]?.kind;
    const allowedSteps = ['guide', 'detail', 'probe', 'deepen', 'reteach', 'quiz', 'summary'];
    const firstStepKind =
      typeof rawFirstStep === 'string' && allowedSteps.includes(rawFirstStep)
        ? rawFirstStep
        : 'guide';
    const meta = spec.meta && typeof spec.meta === 'object' ? (spec.meta as Record<string, unknown>) : {};
    const estimatedMinutes =
      typeof meta.estimatedMinutes === 'number' && meta.estimatedMinutes >= 1
        ? Math.round(meta.estimatedMinutes)
        : 15;

    return {
      levelId: row.id,
      title: row.title,
      itemCount: Number(row.item_count),
      firstStepKind,
      estimatedMinutes,
    };
  }

  /** 图谱聚焦卡的事实来源：邻居与边方向。 */
  private async neighborFact(microKpId: string): Promise<
    Array<{
      microKpId: string;
      name: string;
      relation: 'prereq' | 'related' | 'part_of';
      direction: 'in' | 'out';
      state: string;
    }>
  > {
    const rows = await this.db.query<{
      micro_kp_id: string;
      name: string;
      relation: string;
      direction: string;
      state: string | null;
    }>(
      `SELECT n.id AS micro_kp_id, n.name, e.kind AS relation, 'out' AS direction, m.state
         FROM kp_edges e
         JOIN knowledge_points n ON n.id = e.to_id
         LEFT JOIN mastery m ON m.micro_kp_id = n.id
        WHERE e.from_id = $1
       UNION ALL
       SELECT n.id AS micro_kp_id, n.name, e.kind AS relation, 'in' AS direction, m.state
         FROM kp_edges e
         JOIN knowledge_points n ON n.id = e.from_id
         LEFT JOIN mastery m ON m.micro_kp_id = n.id
        WHERE e.to_id = $1
        LIMIT 12`,
      [microKpId],
    );

    const allowed = new Set(['prereq', 'related', 'part_of']);
    return rows.map((row) => ({
      microKpId: row.micro_kp_id,
      name: row.name,
      relation: (allowed.has(row.relation) ? row.relation : 'related') as
        | 'prereq'
        | 'related'
        | 'part_of',
      direction: (row.direction === 'in' ? 'in' : 'out') as 'in' | 'out',
      state: row.state ?? 'unseen',
    }));
  }

  private async kpName(microKpId: string): Promise<string | null> {
    const rows = await this.db.query<{ name: string }>(
      'SELECT name FROM knowledge_points WHERE id = $1',
      [microKpId],
    );
    return rows[0]?.name ?? null;
  }

  /** 最近几轮（给模型的上下文，也是「历史是日志」的数据源）。 */
  private async recentTurns(
    sessionId: string,
    limit = 3,
  ): Promise<Array<{ utterance: string; cardTitle: string; artifactKind: string }>> {
    const rows = await this.db.query<{
      utterance: string;
      card_title: string;
      artifact_kind: string;
    }>(
      `SELECT utterance, card_title, artifact_kind
         FROM agent_turns
        WHERE session_id = $1
        ORDER BY ordinal DESC
        LIMIT $2`,
      [sessionId, limit],
    );
    return rows
      .map((row) => ({
        utterance: row.utterance,
        cardTitle: row.card_title,
        artifactKind: row.artifact_kind,
      }))
      .reverse();
  }

  /* ---------------------------------------------------------------- *
   * 提示词
   * ---------------------------------------------------------------- */

  /**
   * 组装用户消息。
   *
   * **只放 `allowed` 的切片。** 门控发生在检索层，这里是「拿不到」而不是
   * 「拿得到但别说」——票 09 的核心验收。
   */
  private buildUserMessage(input: {
    utterance: string;
    tier: LearnerTier;
    microKpId: string | null;
    kpName: string | null;
    /** 焦点是从推荐里挑的（学习者还没选定）时，给模型一句来源说明 */
    focusNote: string | null;
    /** 本轮已确立的学习意图；有值时这一轮就该出关卡，不再追问 */
    intent: IntentRecord | null;
    mastery: { achieved: number; current: number; state: string } | null;
    level: { levelId: string; title: string; itemCount: number } | null;
    evidence: GatedChunk[];
    history: Array<{ utterance: string; cardTitle: string }>;
  }): string {
    const lines: string[] = [];

    lines.push('## 学习者的这句话');
    lines.push(input.utterance);
    lines.push('');

    lines.push('## 当前状态（服务端事实，不要改动这些数字）');
    lines.push(`水平档：${input.tier}（P1 入门 / P2 进阶 / P3 综合）`);
    if (input.microKpId) {
      lines.push(`当前知识点：${input.kpName ?? input.microKpId}（${input.microKpId}）`);
      if (input.focusNote) lines.push(input.focusNote);
    } else {
      lines.push('当前知识点：未选定（服务端也没有可推荐的节点，这一轮只能请学习者先自己选）');
    }
    if (input.intent) {
      const goalLabel: Record<IntentGoal, string> = {
        solve_problem: '为了解题',
        read_paper: '为了看懂论文或教材',
        foundation: '为了补基础',
        exam: '为了考试',
        unspecified: '没问出来（学生说别问了）',
      };
      const practice =
        input.intent.preferPractice === true
          ? '先做题'
          : input.intent.preferPractice === false
            ? '先看讲解'
            : '未说';
      lines.push(
        `学习意图：${goalLabel[input.intent.goal]}（${input.intent.goal}）；先讲还是先练：${practice}`,
      );
      lines.push(
        input.intent.goal === 'unspecified'
          ? '（学生明确说了「别问了」：这一轮直接给 level_card，不要再追问意图，也不要再确认。）'
          : '（意图已经明确：这一轮直接给 level_card，不要再追问意图。）',
      );
    }
    if (input.mastery) {
      lines.push(
        `掌握度：achieved=${input.mastery.achieved.toFixed(2)}，current=${input.mastery.current.toFixed(2)}，状态=${input.mastery.state}`,
      );
    } else {
      lines.push('掌握度：尚无记录');
    }
    if (input.level) {
      lines.push(
        `可打开关卡：${input.level.title}（${input.level.levelId}，${input.level.itemCount} 题）`,
      );
    } else {
      lines.push('可打开关卡：无');
    }
    lines.push('');

    if (input.evidence.length > 0) {
      lines.push('## 可引用的教材片段（已通过门控）');
      for (const chunk of input.evidence) {
        const page = chunk.page === null ? '' : `，第 ${chunk.page} 页`;
        lines.push(`- 〔${chunk.sourceTitle}${page}〕${chunk.text.replace(/\s+/g, ' ').slice(0, 220)}`);
      }
      lines.push('');
    } else {
      lines.push('## 可引用的教材片段');
      lines.push('（本次没有通过门控的片段。不要编造引用。）');
      lines.push('');
    }

    if (input.history.length > 0) {
      lines.push('## 最近几轮');
      for (const turn of input.history) {
        lines.push(`- 学生说「${turn.utterance.slice(0, 60)}」→ 出了「${turn.cardTitle}」`);
      }
      lines.push('');
    }

    lines.push('## 你要输出什么');
    lines.push('只输出一个 JSON 对象，字段：');
    lines.push('- visibleResponse：对学习者说的一句话，简体中文，不要用英文单词（专业缩写除外，且首次要加中文解释）。');
    lines.push('- cardKind：这轮该出哪种卡。');
    lines.push('  · level_card —— 学习者需要具体去练一个点，且有可打开的关卡时；');
    lines.push('  · graph_focus —— 学习者在问「这和我学过的有什么关系」或需要看知识结构时；');
    lines.push('  · progress_change —— 学习者完成了一步、值得回看进展时；');
    lines.push('  · probe_form —— 学习者卡住了、该被反问一步时。这时还要给 question（一个以问号结尾的问题）。');
    lines.push('- rationale：一句话说明为什么给这张卡（中文）。');
    lines.push('');
    lines.push('硬约束：');
    lines.push('1. 不要直接给出答案或最终数值——你是在引导，不是在代做。');
    lines.push('2. probe_form 的 question 只能是一个问题，全句只有一个问号。');
    lines.push('3. 不要在 JSON 里额外输出 reasoning / thinking / answer 等字段。');

    return lines.join('\n');
  }

  /* ---------------------------------------------------------------- *
   * 主流程
   * ---------------------------------------------------------------- */

  /**
   * 一次结构化回合。
   *
   * 注意 `retryCount` 的语义：它统计的是**为修复输出而重发的次数**，不是
   * 上游错误重试。上游 5xx 直接降级（重试上游通常还是 5xx，而且会拖长
   * 学生等待）。票 08 只允许重试一次，所以上限是 1。
   */
  async turn(
    request: AgentTurnRequest,
    /**
     * 流式钩子。**不传时行为与之前逐字节相同** —— 这是刻意的：一次性接口
     * 有 300+ 条测试与三档评估依赖，流式不能改它们的结果形状，只能叠加。
     */
    hooks?: TurnStreamHooks,
  ): Promise<AgentTurnResponse> {
    await this.ensureSession(request.sessionId);

    // 学习者没选定时由服务端挑焦点：没有焦点的会话只能反复回同一张占位卡。
    const focus = await this.resolveFocus(
      request.sessionId,
      request.microKpId,
      request.utterance,
    );
    const microKpId = focus.microKpId;
    const kpName = focus.name;

    // 票 79：出关卡之前先问清意图。这一步刻意排在检索与模型调用**之前** ——
    // 还没问清「为了什么」时，任何检索与出题都是在赌，而且白花一次上游调用。
    const meta = await this.readSessionMeta(request.sessionId);
    const intentStep = resolveIntentStep({
      utterance: request.utterance,
      microKpId,
      intent: readIntent(meta),
      askedBefore: hasAskedTheWay(meta),
    });
    if (intentStep.kind === 'ask') {
      const turnId = `at-${randomUUID()}`;
      const createdAt = await this.db.now();
      return this.persistAskTheWay({
        request,
        turnId,
        createdAt,
        microKpId,
        kpName,
      });
    }
    if (intentStep.kind === 'resolve') {
      /* 票 84：自评只在「这一句是答问津」或学生自己说了的时候采信；
         其它情况返回 null（不猜）。 */
      const selfLevel = classifySelfLevel(request.utterance);
      await this.writeSessionMetaKey(request.sessionId, 'intent', {
        goal: intentStep.goal,
        preferPractice: intentStep.preferPractice,
        selfLevel,
        resolvedAt: await this.db.now(),
      });
      this.logger.log(
        `回合前确立意图：${intentStep.goal}（${intentStep.via}）` +
          (selfLevel ? `，自评 ${selfLevel}` : ''),
      );
    }

    // 本轮生效的意图（可能刚刚确立，也可能是会话里早就定下的）：交给模型一句话，
    // 让它知道「这一轮该出关卡了，不要再追问意图」。
    const activeIntent: IntentRecord | null =
      intentStep.kind === 'resolve'
        ? {
            goal: intentStep.goal,
            preferPractice: intentStep.preferPractice,
            selfLevel: classifySelfLevel(request.utterance),
            resolvedAt: '',
          }
        : readIntent(meta);

    const mastery = microKpId ? await this.currentMastery(microKpId) : null;
    const level = microKpId ? await this.levelFact(microKpId) : null;
    const history = await this.recentTurns(request.sessionId);

    // 检索与门控：只有 microKpId 存在时才有意义（门控要对照知识点答案集）。
    let gated: GatedChunk[] = [];
    if (microKpId) {
      try {
        const outcome = await this.retrieval.retrieve({
          query: request.utterance,
          microKpId,
          candidateLimit: 30,
        });
        gated = outcome.gated;
      } catch (error) {
        this.logger.warn(
          `检索失败，本轮无依据：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const allowedEvidence = gated.filter((chunk) => chunk.allowed).slice(0, 6);

    hooks?.onStage?.('retrieval', allowedEvidence.length > 0
      ? `检索命中 ${gated.length} 段，门控放行 ${allowedEvidence.length} 段`
      : '本轮没有可用的教材依据');

    const systemMessage = await this.skills.composeSystemMessage();
    /**
     * 本轮真正注入的技能。判据是「启用」（`skill_switches` 表里没行就是启用），
     * 与 `composeSystemMessage` 用的是同一份扫描结果，所以链上列出的就是提示里
     * 真出现过的那几个 —— 不是「库里有哪些」。
     */
    const injectedSkills = (await this.skills.list())
      .items.filter((item) => item.enabled)
      .map((item) => ({ name: item.name, description: item.description }));
    hooks?.onStage?.('decision', `判定：档位 ${request.tier}，焦点「${kpName}」`);

    const userMessage = this.buildUserMessage({
      utterance: request.utterance,
      tier: request.tier,
      microKpId,
      kpName,
      focusNote: focus.note,
      intent: activeIntent,
      mastery,
      level,
      evidence: allowedEvidence,
      history,
    });

    const messages: LlmMessage[] = [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage },
    ];

    let retryCount = 0;
    let plan: Plan | null = null;
    /**
     * 决策链的原料。只收「本项目自己做出的决定」与端口能给的模型元数据：
     * - 检索：候选多少条、门控放行多少条、放行的是哪些 chunk（id + 分数 + 开头）
     * - 判定：档位、焦点、是否重试、是否降级
     * - 模型：名字与墙钟耗时；reasoning 拿不到就是 null（界面显示「未返回」）
     */
    const modelFacts: { model?: string; latencyMs?: number; reasoning?: string } = {};
    let lastIssues: string[] = [];
    let upstreamError: string | null = null;

    for (let attempt = 0; attempt <= 1; attempt += 1) {
      try {
        hooks?.onStage?.('model', '上游已开始生成');
        const result = hooks?.onToken
          ? await completeStreamingWith(this.llm, messages, hooks)
          : await this.llm.complete({
              messages,
              schema: PLAN_JSON_SCHEMA,
              temperature: 0.4,
            });
        Object.assign(modelFacts, {
          model: result.model,
          latencyMs: result.latencyMs,
          reasoning: result.reasoning,
        });
        // 先剥内部字段再校验：模型塞进来的 reasoning/answer 不该让整轮作废，
        // 但它们更不能进响应、进 DOM。
        const stripped = stripInternalFields(result.parsed ?? tryParse(result.text));
        const parsed = PlanSchema.safeParse(stripped);
        if (parsed.success) {
          plan = parsed.data;
          break;
        }
        lastIssues = formatIssues(parsed.error);
      } catch (error) {
        upstreamError = error instanceof Error ? error.message : String(error);
        break; // 上游错误不重试：直接降级，别让学生干等
      }

      if (attempt === 0) {
        retryCount = 1;
        messages.push({
          role: 'user',
          content: REPAIR_INSTRUCTION,
        });
      }
    }

    const turnId = `at-${randomUUID()}`;
    const createdAt = await this.db.now();

    if (!plan) {
      return this.persistDegraded({
        request,
        turnId,
        createdAt,
        trace: this.buildTrace({
          skills: injectedSkills,
          gated,
          allowedEvidence,
          tier: request.tier,
          focusNote: focus.note,
          retryCount,
          modelFacts,
          degraded: true,
          degradedReason: upstreamError ?? lastIssues.join('；'),
        }),
        retryCount,
        issues: lastIssues,
        upstreamError,
        gated,
      });
    }

    // 模型可以指定这一轮换到另一个知识点，但它给的 id 不一定存在。
    // 不校验的话 `probe.start()` 会抛 NotFoundException，整轮变成 500 ——
    // 学生只看到「服务器内部错误」，而模型其实已经把话说完了。
    let targetKpId = microKpId;
    let targetName = kpName;
    let targetMastery = mastery;
    let targetLevel = level;
    if (plan.microKpId && plan.microKpId !== microKpId) {
      if (await this.knowledgePointExists(plan.microKpId)) {
        targetKpId = plan.microKpId;
        targetName = await this.kpName(plan.microKpId);
        targetMastery = await this.currentMastery(plan.microKpId);
        targetLevel = await this.levelFact(plan.microKpId);
      } else {
        this.logger.warn(
          `模型给了不存在的知识点 ${plan.microKpId}，改用服务端焦点 ${microKpId ?? '（无）'}`,
        );
      }
    }

    const trace = this.buildTrace({
      skills: injectedSkills,
      gated,
      allowedEvidence,
      tier: request.tier,
      focusNote: focus.note,
      retryCount,
      modelFacts,
      degraded: false,
    });

    return this.persistTurn({
      request,
      turnId,
      trace,
      createdAt,
      retryCount,
      plan,
      microKpId: targetKpId,
      kpName: targetName,
      mastery: targetMastery,
      level: targetLevel,
      gated,
    });
  }

  /** 正常路径：模型给了可用的意图 → 服务端渲染成卡 → 落库。 */
  /** 读会话 meta（没有就是空对象）。 */
  private async readSessionMeta(sessionId: string): Promise<Record<string, unknown>> {
    const rows = await this.db.query<{ meta: Record<string, unknown> | null }>(
      'SELECT meta FROM sessions WHERE id = $1',
      [sessionId],
    );
    return rows[0]?.meta ?? {};
  }

  /** 只覆盖一个键，保留 meta 里其它键（掌握度快照等）。 */
  private async writeSessionMetaKey(
    sessionId: string,
    key: string,
    value: unknown,
  ): Promise<void> {
    await this.db.query(
      `UPDATE sessions
          SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb)
        WHERE id = $1`,
      [sessionId, key, JSON.stringify(value)],
    );
  }

  /**
   * 「问津」回合：不出关卡，先问一句。
   *
   * 产物仍然是 `probe_form` —— 票 79 明确要求复用追问卡的渲染，不新造第五种
   * 卡。真正的区别在响应的 `clarify` 字段与 `meta.askTheWay` 标记：前者让前端
   * 知道这是一次意图确认，后者让下一轮知道「这句是答案，不是新话题」。
   */
  private async persistAskTheWay(input: {
    request: AgentTurnRequest;
    turnId: string;
    createdAt: string;
    microKpId: string | null;
    kpName: string | null;
  }): Promise<AgentTurnResponse> {
    const { request, turnId, createdAt, microKpId, kpName } = input;

    const clarify: AgentClarify = {
      question: ASK_THE_WAY_QUESTION,
      options: [...ASK_THE_WAY_OPTIONS],
      /* 票 84：同一张卡上再要一次**熟练度自评**。
         为什么不是再问一轮 —— 目标与自评是同一件事的两半：
         「为了考试」配「完全没学过」与配「很熟」会导向完全不同的首轮渲染
         （P1 完整样例 vs P3 直接出题）。拆成两轮要学生多等一次往返，
         而这两个答案本可以在一屏里同时给出。
         四个档位的措辞刻意用「学生的说法」而不是 P1/P2/P3 这类内部代号：
         学生不知道自己的档位，只能报「我大概是什么水平」。 */
      selfLevelOptions: [
        '完全没学过',
        '见过但不会用',
        '会做但慢',
        '很熟',
      ],
      why: ASK_THE_WAY_WHY,
    };
    const languageCheck: AgentLanguageCheck = (() => {
      const check = checkChinese(clarify.question);
      return { ok: check.ok, offenders: check.offenders };
    })();

    const actions = defaultActions('probe_form');
    const hydrated = hydrateArtifact(
      {
        kind: 'probe_form',
        cardId: turnId,
        createdAt,
        probeId: `clarify-${turnId}`,
        microKpId: microKpId ?? '',
        question: clarify.question,
        ladderLevel: 1,
        ladderCap: 1,
        inputKind: 'choice',
        choices: [...ASK_THE_WAY_OPTIONS],
        actions,
        rationale: clarify.why,
        title: kpName ? `问津：${kpName}` : '问津',
      },
      { cardId: turnId, createdAt, actions },
    );

    const ordinal = await this.nextOrdinal(request.sessionId);
    await this.db.query(
      `INSERT INTO agent_turns
         (id, session_id, ordinal, utterance, visible_response, visible_response_kind,
          artifact_kind, card_title, degraded, retry_count, artifact, language_check, micro_kp_id, trace)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,0,$9::jsonb,$10::jsonb,$11,$12::jsonb)`,
      [
        turnId,
        request.sessionId,
        ordinal,
        request.utterance,
        clarify.question,
        'probe_question' satisfies VisibleResponseKind,
        hydrated.kind,
        hydrated.title || this.titleOf(hydrated),
        JSON.stringify(hydrated),
        JSON.stringify(languageCheck),
        microKpId,
        // 问津这一轮不调模型，但「为什么问、问了什么」本身就是决策链的一环，
        // 所以也落一份最小 trace：只有 decisions（无检索命中、无模型耗时）。
        JSON.stringify({
          skills: [],
          retrieval: { candidates: 0, allowed: 0, used: 0, chunks: [] },
          decisions: {
            tier: request.tier ?? null,
            focusNote: '问津：意图未明，先问一句再决定教什么',
            retryCount: 0,
            degraded: false,
          },
          model: { name: null, latencyMs: null, reasoning: null },
        }),
      ],
    );

    // 记「问过一次」：下一轮的回答就是意图，不再追问。
    await this.writeSessionMetaKey(request.sessionId, 'askTheWay', {
      askedAt: createdAt,
      microKpId,
    });

    return AgentTurnResponseSchema.parse({
      // 问津这一轮的决策链与上面落库的那份是同一份，避免界面与库内不一致
      trace: {
        skills: [],
        retrieval: { candidates: 0, allowed: 0, used: 0, chunks: [] },
        decisions: {
          tier: request.tier ?? null,
          focusNote: '问津：意图未明，先问一句再决定教什么',
          retryCount: 0,
          degraded: false,
        },
        model: { name: null, latencyMs: null, reasoning: null },
      },
      turnId,
      sessionId: request.sessionId,
      artifact: hydrated,
      errorCard: null,
      degraded: false,
      retryCount: 0,
      visibleResponse: clarify.question,
      visibleResponseKind: 'probe_question',
      languageCheck,
      actions,
      clarify,
      createdAt,
    });
  }

  private async persistTurn(input: {
    request: AgentTurnRequest;
    turnId: string;
    createdAt: string;
    retryCount: number;
    plan: Plan;
    microKpId: string | null;
    kpName: string | null;
    mastery: { achieved: number; current: number; state: string } | null;
    level: { levelId: string; title: string; itemCount: number; firstStepKind: string; estimatedMinutes: number } | null;
    gated: GatedChunk[];
    trace: Record<string, unknown>;
  }): Promise<AgentTurnResponse> {
    const { plan, turnId, createdAt } = input;
    const visibleResponse = plan.visibleResponse.trim();
    const visibleResponseKind: VisibleResponseKind = /[?？]\s*$/.test(visibleResponse)
      ? 'probe_question'
      : 'statement';

    const languageCheck: AgentLanguageCheck = (() => {
      const check = checkChinese(visibleResponse);
      return { ok: check.ok, offenders: check.offenders };
    })();

    const artifact = await this.buildArtifact({
      plan,
      cardId: turnId,
      createdAt,
      microKpId: input.microKpId,
      kpName: input.kpName,
      mastery: input.mastery,
      level: input.level,
      sessionId: input.request.sessionId,
      tier: input.request.tier,
    });

    const actions = defaultActions(artifact.kind);
    const hydrated = hydrateArtifact(artifact, {
      cardId: turnId,
      createdAt,
      actions,
    });

    const ordinal = await this.nextOrdinal(input.request.sessionId);
    await this.db.query(
      `INSERT INTO agent_turns
         (id, session_id, ordinal, utterance, visible_response, visible_response_kind,
          artifact_kind, card_title, degraded, retry_count, artifact, language_check, micro_kp_id, trace)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10::jsonb,$11::jsonb,$12,$13::jsonb)`,
      [
        turnId,
        input.request.sessionId,
        ordinal,
        input.request.utterance,
        visibleResponse,
        visibleResponseKind,
        hydrated.kind,
        hydrated.title || this.titleOf(hydrated),
        input.retryCount,
        JSON.stringify(hydrated),
        JSON.stringify(languageCheck),
        input.microKpId,
        JSON.stringify(input.trace),
      ],
    );

    await this.persistEvidence(turnId, input.gated);

    const response = AgentTurnResponseSchema.parse({
      turnId,
      sessionId: input.request.sessionId,
      trace: input.trace,
      artifact: hydrated,
      errorCard: null,
      degraded: false,
      retryCount: input.retryCount,
      visibleResponse,
      visibleResponseKind,
      languageCheck,
      actions,
      createdAt,
    });

    if (!languageCheck.ok) {
      this.logger.warn(
        `回合 ${turnId} 的可见回复含未加注英文：${languageCheck.offenders.join(', ')}`,
      );
    }
    return response;
  }

  /**
   * 卡片骨架：模型给意图，服务端填事实。
   *
   * 每一种卡都有一个「事实不够就不给这张卡」的退路——宁可退化成 `probe_form`
   * 或 `level_card`，也不给一张字段是编的卡。
   */
  private async buildArtifact(input: {
    plan: Plan;
    cardId: string;
    createdAt: string;
    microKpId: string | null;
    kpName: string | null;
    mastery: { achieved: number; current: number; state: string } | null;
    level: { levelId: string; title: string; itemCount: number; firstStepKind: string; estimatedMinutes: number } | null;
    sessionId: string;
    tier: LearnerTier;
  }): Promise<AgentArtifact> {
    const microKpId = input.microKpId;
    const base = { cardId: input.cardId, createdAt: input.createdAt };

    if (!microKpId) {
      // 走到这里只剩一种可能：学习者没选定，而且推荐也是空的（新库，或所有
      // 叶节点都还没有内容）。这不是错误，所以给一张陈述卡而不是降级卡 ——
      // 但理由必须说清「是服务端也没得推荐」，否则学生会以为按钮坏了。
      return {
        ...base,
        kind: 'graph_focus',
        microKpId: '',
        name: '还没有选定知识点',
        neighbors: [],
        title: '先在知识地图上选一个点',
        rationale: `${input.plan.rationale}（服务端此刻也没有可推荐的节点：题库还没有内容。）`,
      };
    }

    const kind: AgentArtifactKind = input.plan.cardKind;

    if (kind === 'level_card' && input.level) {
      return {
        ...base,
        kind: 'level_card',
        levelId: input.level.levelId,
        microKpId,
        tier: input.tier,
        estimatedMinutes: input.level.estimatedMinutes,
        itemCount: input.level.itemCount,
        firstStepKind: input.level.firstStepKind as
          | 'guide'
          | 'detail'
          | 'probe'
          | 'deepen'
          | 'reteach'
          | 'quiz'
          | 'summary',
        title: input.level.title,
        rationale: input.plan.rationale,
      };
    }

    if (kind === 'graph_focus') {
      const neighbors = await this.neighborFact(microKpId);
      return {
        ...base,
        kind: 'graph_focus',
        microKpId,
        name: input.kpName ?? microKpId,
        neighbors: neighbors as never,
        title: `知识结构：${input.kpName ?? microKpId}`,
        rationale: input.plan.rationale,
      };
    }

    if (kind === 'progress_change') {
      const after = input.mastery ?? { achieved: 0, current: 0, state: 'unseen' };
      const before =
        (await this.sessionStartMastery(input.sessionId, microKpId)) ?? after;
      const evidenceCount = await this.evidenceCount(microKpId);
      return {
        ...base,
        kind: 'progress_change',
        microKpId,
        name: input.kpName ?? microKpId,
        before: before as never,
        after: after as never,
        title: `进度：${input.kpName ?? microKpId}`,
        // 进度卡的「为什么」走 `reason` 而不是 `rationale`：它同时要解释
        // 「分数为什么变」和「为什么现在给你看这张卡」，是同一句话。
        reason: input.plan.rationale,
        evidenceCount,
      };
    }

    // probe_form（也是 level_card 事实不足时的退路）
    const question = this.pickQuestion(input.plan);
    const session = await this.probe.start({ microKpId, tier: input.tier });
    return {
      ...base,
      kind: 'probe_form',
      probeId: session.probeId,
      microKpId,
      question,
      ladderLevel: Math.max(1, session.ladder.level || 1),
      ladderCap: session.ladder.cap,
      inputKind: input.plan.inputKind ?? 'free_text',
      choices: input.plan.inputKind === 'choice' ? (input.plan.choices ?? []) : [],
      actions: defaultActions('probe_form'),
      title: `追问：${input.kpName ?? microKpId}`,
      rationale: input.plan.rationale,
    };
  }

  /** 保证问句以问号结尾且只有一个问号（票 10：每轮只问一个问题）。 */
  private pickQuestion(plan: Plan): string {
    const raw = (plan.question ?? plan.visibleResponse).trim();
    const questionMarks = raw.match(/[?？]/g)?.length ?? 0;
    if (questionMarks === 1 && /[?？]$/.test(raw)) return raw;
    // 去掉多余问号后补一个：宁可句子笨一点，也不能在一轮里问两件事。
    const trimmed = raw.replace(/[?？]+/g, '').replace(/[。.!！]+$/, '').trim();
    return `${trimmed}这一步你是怎么判断的？`;
  }

  private async evidenceCount(microKpId: string): Promise<number> {
    const rows = await this.db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM attempts WHERE micro_kp_id = $1',
      [microKpId],
    );
    return Number(rows[0]?.count ?? '0');
  }

  private titleOf(artifact: AgentArtifact): string {
    switch (artifact.kind) {
      case 'level_card':
        return `关卡：${artifact.title}`;
      case 'graph_focus':
        return `图谱：${artifact.name}`;
      case 'progress_change':
        return `进度：${artifact.name}`;
      case 'probe_form':
        return `追问：${artifact.question}`;
      default:
        return '学习记录';
    }
  }

  /** 依据留痕：命中什么、是否答案块、为什么被排除。 */
  /**
   * 把本轮的决策原料压成一份可核对的快照。
   *
   * 刻意只放「有据可查」的东西：`gated` 的每一条都来自检索服务，`allowed`
   * 是门控真实判定，`model.latencyMs` 是端口实测。没有一项是估算。
   * `reasoning` 只在 provider 真返回时才有值，否则 null —— 界面据此显示
   * 「该模型未返回推理内容」，不编造思考过程。
   */
  private buildTrace(input: {
    skills: Array<{ name: string; description: string }>;
    gated: GatedChunk[];
    allowedEvidence: GatedChunk[];
    tier?: string;
    focusNote?: string | null;
    retryCount: number;
    modelFacts: { model?: string; latencyMs?: number; reasoning?: string };
    degraded: boolean;
    degradedReason?: string;
  }): Record<string, unknown> {
    const pick = (chunk: GatedChunk): Record<string, unknown> => {
      const raw = chunk as unknown as {
        chunkId?: string;
        score?: number;
        allowed?: boolean;
        reason?: string;
        text?: string;
      };
      return {
        chunkId: raw.chunkId ?? null,
        score: typeof raw.score === 'number' ? Number(raw.score.toFixed(4)) : null,
        allowed: raw.allowed === true,
        gateReason: raw.reason ?? null,
        excerpt: (raw.text ?? '').slice(0, 80),
      };
    };

    return {
      skills: input.skills.map((skill) => ({
        name: skill.name,
        description: skill.description.slice(0, 60),
      })),
      retrieval: {
        candidates: input.gated.length,
        allowed: input.gated.filter((chunk) => chunk.allowed === true).length,
        used: input.allowedEvidence.length,
        chunks: input.gated.slice(0, 8).map(pick),
      },
      decisions: {
        tier: input.tier ?? null,
        focusNote: input.focusNote ?? null,
        retryCount: input.retryCount,
        degraded: input.degraded,
        ...(input.degraded ? { degradedReason: input.degradedReason ?? null } : {}),
      },
      model: {
        name: input.modelFacts.model ?? null,
        latencyMs: input.modelFacts.latencyMs ?? null,
        reasoning: input.modelFacts.reasoning ?? null,
      },
    };
  }

  private async persistEvidence(turnId: string, gated: GatedChunk[]): Promise<void> {
    const rows = gated.slice(0, MAX_EVIDENCE_ROWS);
    if (rows.length === 0) return;

    // 一条 INSERT 多行 VALUES：8 条以内，参数数可控，且是原子的。
    const values: string[] = [];
    const params: unknown[] = [];
    rows.forEach((chunk, index) => {
      const offset = index * 7;
      values.push(
        `($${offset + 1},$${offset + 2},$${offset + 3}::numeric,$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7})`,
      );
      params.push(
        turnId,
        chunk.id,
        chunk.score,
        chunk.isAnswerChunk,
        chunk.allowed,
        chunk.tier,
        chunk.exclusionReason,
      );
    });

    await this.db.query(
      `INSERT INTO agent_turn_evidence
         (turn_id, chunk_id, score, is_answer_chunk, allowed, gate_tier, exclusion_reason)
       VALUES ${values.join(',')}
       ON CONFLICT (turn_id, chunk_id) DO NOTHING`,
      params,
    );
  }

  /**
   * 降级路径。
   *
   * 三件事必须同时成立：可读（中文、不甩栈）、可重试（`retryable`）、
   * 可排查（`debugId` 能和服务端日志对上）。**不含模型原文**。
   */
  private async persistDegraded(input: {
    request: AgentTurnRequest;
    turnId: string;
    createdAt: string;
    retryCount: number;
    issues: string[];
    upstreamError: string | null;
    gated: GatedChunk[];
    trace: Record<string, unknown>;
  }): Promise<AgentTurnResponse> {
    const debugId = createHash('sha256')
      .update(`${input.turnId}:${input.issues.join('|')}:${input.upstreamError ?? ''}`)
      .digest('hex')
      .slice(0, 12);

    const upstream = input.upstreamError !== null;
    const errorCard: AgentErrorCard = {
      title: upstream ? '模型暂时不可用' : '这次没能生成卡片',
      detail: upstream
        ? '上游模型没有返回结果。你的这句话已经记下，可以直接重试。'
        : `模型的输出没有通过结构校验（${input.issues.slice(0, 2).join('；') || '字段缺失'}）。已经自动重试过一次。`,
      retryable: true,
      debugId,
    };

    const visibleResponse = upstream
      ? '模型这会儿没有响应，我们稍后再试一次。要不要先说说你卡在哪一步？'
      : '这次我没能把你的问题变成一张卡片。你可以换个说法再问一次，或者先说说你卡在哪一步？';

    const languageCheck: AgentLanguageCheck = (() => {
      const check = checkChinese(visibleResponse);
      return { ok: check.ok, offenders: check.offenders };
    })();

    this.logger.warn(
      `回合降级 ${input.turnId}（debugId=${debugId}，upstream=${upstream}）：${
        upstream ? input.upstreamError : input.issues.join('; ')
      }`,
    );

    const ordinal = await this.nextOrdinal(input.request.sessionId);
    await this.db.query(
      `INSERT INTO agent_turns
         (id, session_id, ordinal, utterance, visible_response, visible_response_kind,
          artifact_kind, card_title, degraded, retry_count, artifact, language_check, micro_kp_id, trace)
       VALUES ($1,$2,$3,$4,$5,'statement','error_card',$6,true,$7,$8::jsonb,$9::jsonb,$10,$11::jsonb)`,
      [
        input.turnId,
        input.request.sessionId,
        ordinal,
        input.request.utterance,
        visibleResponse,
        errorCard.title,
        input.retryCount,
        // 降级卡也要整卡落库：`artifact_kind` 只说「这是一次降级」，
        // 但 `detail`/`debugId` 是学生报问题时要念给支持人员的东西，
        // 只留在响应里就等于刷新页面后无法复述。信封形状与四张卡不冲突
        // （它们的 `kind` 是枚举值，这里是 `errorCard` 键）。
        JSON.stringify({ errorCard }),
        JSON.stringify(languageCheck),
        input.request.microKpId,
        JSON.stringify(input.trace),
      ],
    );
    await this.persistEvidence(input.turnId, input.gated);

    const actions: AgentCardAction[] = [
      { kind: 'retry', label: '再试一次', enabled: true },
      { kind: 'show_evidence', label: '看依据', enabled: input.gated.some((c) => c.allowed) },
    ];

    return AgentTurnResponseSchema.parse({
      turnId: input.turnId,
      sessionId: input.request.sessionId,
      trace: input.trace,
      artifact: null,
      errorCard,
      degraded: true,
      retryCount: input.retryCount,
      visibleResponse,
      visibleResponseKind: 'statement',
      languageCheck,
      actions,
      createdAt: input.createdAt,
    });
  }

  /* ---------------------------------------------------------------- *
   * 读接口
   * ---------------------------------------------------------------- */

  /**
   * 学习日志（票 08：历史是日志，不是消息流）。
   *
   * `createdAt` 走 `isoTimestamp`：pg 把 `timestamptz` 解成 JS `Date`，
   * 而契约要求 ISO 8601 字符串。创建路径上用的是 `db.now()`（SQL 侧转好），
   * 读路径却拿到 `Date` —— 这个不对称曾让「回看」整个 500，而「新一轮」正常。
   */
  async history(sessionId: string, limit = 50): Promise<AgentTurnHistoryResponse> {
    await this.ensureSession(sessionId);
    const rows = await this.db.query<{
      id: string;
      session_id: string;
      utterance: string;
      artifact_kind: string;
      card_title: string;
      degraded: boolean;
      /** pg 把 timestamptz 解成 Date；写 `string` 会让这个不对称沉进类型系统 */
      created_at: Date | string;
    }>(
      `SELECT id, session_id, utterance, artifact_kind, card_title, degraded, created_at
         FROM agent_turns
        WHERE session_id = $1
        ORDER BY ordinal ASC
        LIMIT $2`,
      [sessionId, limit],
    );

    return AgentTurnHistoryResponseSchema.parse({
      sessionId,
      items: rows.map((row) => ({
        turnId: row.id,
        sessionId: row.session_id,
        utterance: row.utterance,
        artifactKind: row.artifact_kind,
        cardTitle: row.card_title,
        degraded: row.degraded,
        createdAt: isoTimestamp(row.created_at),
      })),
      nextCursor: null,
    });
  }

  /**
   * 「学习记录」的会话列表（票 76）。
   *
   * ## 为什么是一条 SQL 而不是「先查会话、再逐个查首句」
   *
   * 会话列表一屏 50 条，N+1 就是 51 次往返；而首句与聚合都能在同一次扫描里
   * 算出来。这里用 `DISTINCT ON (session_id) ... ORDER BY session_id, ordinal`
   * 取每会话 `ordinal` 最小那轮（**不是** `created_at` 最早那轮：重试/回填会让
   * 两者的顺序不一致，而 `ordinal` 才是「这一轮是第几句」的权威），外层再
   * JOIN 一张 `count/min/max` 聚合表。
   *
   * ## 为什么空库返回 `{sessions: []}`
   *
   * 「还没有任何会话」是一个合法状态，不是错误。404 会让前端把它渲染成失败，
   * 学生会以为是自己网络坏了。
   */
  async sessions(limit = 50): Promise<AgentSessionListResponse> {
    const rows = await this.db.query<{
      session_id: string;
      started_at: Date | string | null;
      ended_at: Date | string | null;
      turn_count: number;
      first_utterance: string;
      last_activity_at: Date | string;
    }>(
      `SELECT first_turn.session_id,
              sessions.started_at,
              sessions.ended_at,
              totals.turn_count,
              first_turn.utterance AS first_utterance,
              totals.last_activity_at
         FROM (
                SELECT DISTINCT ON (session_id) session_id, utterance, created_at
                  FROM agent_turns
                 ORDER BY session_id, ordinal ASC
              ) AS first_turn
         JOIN (
                SELECT session_id,
                       count(*)::int AS turn_count,
                       min(created_at) AS first_activity_at,
                       max(created_at) AS last_activity_at
                  FROM agent_turns
                 GROUP BY session_id
              ) AS totals ON totals.session_id = first_turn.session_id
         LEFT JOIN sessions ON sessions.id = first_turn.session_id
        ORDER BY totals.last_activity_at DESC, first_turn.session_id DESC
        LIMIT $1`,
      [limit],
    );

    return AgentSessionListResponseSchema.parse({
      sessions: rows.map((row) => ({
        sessionId: row.session_id,
        // `sessions.started_at` 有默认值，但历史行可能被人工清过；回落到首轮时间
        // 而不是给一个空字符串 —— 空字符串会让前端 `new Date('')` 得到 Invalid Date。
        startedAt: isoTimestamp(row.started_at ?? row.last_activity_at),
        endedAt: row.ended_at === null ? null : isoTimestamp(row.ended_at),
        turnCount: row.turn_count,
        firstUtterance: summarizeUtterance(row.first_utterance),
        lastActivityAt: isoTimestamp(row.last_activity_at),
      })),
    });
  }

  /**
   * 单轮回看（票 08 的「可回看」）。
   *
   * 日志只记「第几轮、说了什么、出过哪种卡、标题是什么」；点开某一行要看的是
   * **那张卡的完整内容**。这份内容在落库时就已经过契约校验并整卡存进
   * `app.agent_turns.artifact`，所以这里只做读出 + 再校验一次，不重新调模型
   * （重放会漂移：同一个问题两次生成的卡不一样，历史会自己变形）。
   *
   * 之前想过在前端存一份快照，被否掉了：那等于给「卡片正文」造了第二个真源，
   * 清缓存 / 换设备 / 两个标签页就会不一致，而服务端本来就有一模一样的东西。
   */
  async get(turnId: string): Promise<AgentTurnResponse> {
    const rows = await this.db.query<{
      id: string;
      session_id: string;
      visible_response: string;
      visible_response_kind: string;
      artifact_kind: string;
      degraded: boolean;
      retry_count: number;
      artifact: unknown;
      language_check: unknown;
      created_at: Date | string;
    }>(
      `SELECT id, session_id, visible_response, visible_response_kind, artifact_kind,
              degraded, retry_count, artifact, language_check, created_at
         FROM agent_turns
        WHERE id = $1`,
      [turnId],
    );

    const row = rows[0];
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `回合不存在: ${turnId}` });
    }

    // 降级轮落的是 `{ errorCard }` 信封；正常轮落的是产物卡本体。
    const stored = row.artifact as { errorCard?: AgentErrorCard } | null;
    const errorCard = stored?.errorCard ?? null;
    const artifact = row.degraded ? null : (stored as AgentArtifact | null);

    const actions =
      artifact !== null
        ? defaultActions(artifact.kind)
        : ([
            { kind: 'retry', label: '再试一次', enabled: true },
            { kind: 'show_evidence', label: '看依据', enabled: true },
          ] satisfies AgentCardAction[]);

    const languageCheck =
      (row.language_check as AgentLanguageCheck | null) ?? { ok: true, offenders: [] };

    return AgentTurnResponseSchema.parse({
      turnId: row.id,
      sessionId: row.session_id,
      artifact,
      errorCard,
      degraded: row.degraded,
      retryCount: row.retry_count,
      visibleResponse: row.visible_response,
      visibleResponseKind: row.visible_response_kind,
      languageCheck,
      actions,
      createdAt: isoTimestamp(row.created_at),
    });
  }

  /**
   * 「看依据」。
   *
   * 读的是**当轮存下来的判定**，不是重新检索：掌握度会变，重新检索会给出
   * 不同的门控结论，学生会发现「当初看到的解释」和现在对不上。
   */
  async evidence(turnId: string): Promise<AgentTurnEvidenceResponse> {
    const turns = await this.db.query<{ micro_kp_id: string | null }>(
      'SELECT micro_kp_id FROM agent_turns WHERE id = $1',
      [turnId],
    );
    const turn = turns[0];
    if (!turn) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `回合不存在: ${turnId}` });
    }

    const rows = await this.db.query<{
      chunk_id: string;
      source_id: string;
      source_title: string;
      page: number | null;
      kind: string;
      text: string;
      score: string;
      is_answer_chunk: boolean;
      allowed: boolean;
      gate_tier: string;
      exclusion_reason: string | null;
    }>(
      `SELECT e.chunk_id, c.source_id, s.title AS source_title, c.page, c.kind, c.text,
              e.score::text AS score, e.is_answer_chunk, e.allowed, e.gate_tier, e.exclusion_reason
         FROM agent_turn_evidence e
         JOIN chunks c ON c.id = e.chunk_id
         JOIN sources s ON s.id = c.source_id
        WHERE e.turn_id = $1
        ORDER BY e.score DESC`,
      [turnId],
    );

    return AgentTurnEvidenceResponseSchema.parse({
      turnId,
      microKpId: turn.micro_kp_id,
      gateTier: rows[0]?.gate_tier ?? 'background',
      items: rows.map((row) => ({
        chunkId: row.chunk_id,
        sourceId: row.source_id,
        sourceTitle: row.source_title,
        page: row.page,
        kind: row.kind,
        snippet: this.retrieval.snippet(row.text, ''),
        score: Number(row.score),
        isAnswerChunk: row.is_answer_chunk,
        allowed: row.allowed,
        tier: row.gate_tier,
        exclusionReason: row.exclusion_reason,
      })),
    });
  }
}

/** `LlmResult.parsed` 为 null 时的最后一次尝试：直接解析文本。 */
/**
 * `timestamptz` → ISO 字符串。
 *
 * pg 驱动把 `timestamptz` 解成 `Date`。契约（以及所有 JSON 消费方）要的是
 * ISO 8601 字符串，直接塞 `Date` 会得到一个能 toString 但过不了 zod 的值 ——
 * 症状是 500 而不是类型错，因为校验发生在运行时。
 *
 * 两种输入都接受：同一列在「刚写进去又读出来」和「SQL 侧 now()」两条路径上
 * 类型不同，与其赌哪条，不如两条都收。
 */
function isoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * 首句摘要：最多 60 个字符，超出补 `…`。
 *
 * 用 `Array.from` 而不是 `slice`：`slice(0, 60)` 数的是 UTF-16 码元，一个 emoji
 * 占两个，会把代理对劈成半个字符（页面上显示成 `�`）。按码点计数才对得上
 * 「60 个字符」这句话。
 */
export const SUMMARY_MAX_CHARS = 60;

export function summarizeUtterance(utterance: string): string {
  const compact = utterance.replace(/\s+/g, ' ').trim();
  const chars = Array.from(compact);
  if (chars.length <= SUMMARY_MAX_CHARS) return compact;
  return `${chars.slice(0, SUMMARY_MAX_CHARS).join('')}…`;
}

function tryParse(text: string): unknown {
  if (typeof text !== 'string') return null;
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** 让 `checkProbeForm` 在编译期有个使用点（保证 probe_question 一定带问号）。 */
export function assertVisibleResponseForm(
  visibleResponse: string,
  kind: VisibleResponseKind,
): void {
  const form = checkProbeForm(visibleResponse, kind === 'probe_question');
  if (!form.ok) {
    throw new Error(`可见回复形态不合法（${form.reason}）：${visibleResponse.slice(0, 60)}`);
  }


}
