import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import type {
  PlacementAnswerRequest,
  PlacementAnswerResponse,
  PlacementItemView,
  PlacementRejudgeResponse,
  PlacementRejudgeEvent,
  PlacementResultResponse,
  PlacementReviewItem,
  PlacementSessionResponse,
  PlacementStartRequest,
  PlacementStatusResponse,
  PlacementTier,
  SelfAssessmentFormResponse,
  SelfAssessmentSubmitRequest,
  SelfAssessmentSubmitResponse,
} from '@starmap/api-contract';
import {
  MASTERY_MIN_ATTEMPTS,
  MASTERY_MIN_VARIANTS,
  PLACEMENT_LIMITS,
  PLACEMENT_LOW_CONFIDENCE,
  PROFICIENT_THRESHOLD,
  SELF_ASSESSMENT_QUESTIONS,
  initialPlacementState,
  placementResult,
  placementStop,
  posteriorStandardDeviation,
  priorFromSelfAssessment,
  recordPlacementAnswer,
  selectPlacementItem,
  shouldRejudge,
  tierProbabilities,
  type PlacementDifficulty,
  type PlacementItem,
  type PlacementState,
} from '@starmap/engine';
import { DatabaseService } from '../db/database.service.js';
import { judgeAnswer, optionCount } from '../mastery/judge.js';
import { groupByMicroKp, snapshotOf } from '../mastery/evidence.js';
import { loadEvidence, type Runner } from '../mastery/repository.js';
import { BadRequestException } from '@nestjs/common';

/**
 * 初始定级服务（票 11）。
 *
 * ## 策略在 engine，编排在这里
 *
 * `packages/engine/src/placement.ts` 是纯函数：后验怎么更新、什么时候停、
 * 结果取哪一档 —— 全在那儿，有 26 条测试。本服务只做三件事：
 *
 * 1. **选题池**：从「即将要学的知识点」里取有题的关卡（票 11 验收 2）；
 * 2. **持久化**：会话、作答、结论各有去处（0023 迁移）；
 * 3. **翻译**：把 engine 的状态翻成接口形状，把中文解释拼出来。
 *
 * 这条分工让「8–18 题」「三个停止条件」可以在毫秒级测试里被穷举，而不必
 * 起一个数据库。反过来说，如果停止条件写在 SQL 或 if 链里，本文件就会变成
 * 一个没人敢改的巨型方法。
 *
 * ## 为什么不写 `app.attempts`
 *
 * 票 11 验收 6：定级不是练习，不产生掌握度记录。**结构上**保证：
 * 定级作答落 `app.placement_answers`，与 BKT 回放读的 `app.attempts` 是两张
 * 不同的表。不靠一个 `counts_toward_mastery` 布尔列来区分 —— 那种设计里，
 * 只要有人写错一个 `true`，学习者一进门就被判成「已掌握 8 个知识点」。
 *
 * ## 为什么题池要快照
 *
 * 会话开始时把候选题（含难度）整块存进 `placement_sessions.pool`。若每次
 * 作答都重新查询，中途有人往库里加了一道更" informational"的题，已经答了
 * 6 题的人会突然看到一道新题，而停止条件的分母（总题数）也变了。快照让
 * 「这次定级考什么」在开始时就被冻结。
 */

/** 一个候选定级题（含判分与解析需要的全部列）。 */
type CandidateRow = {
  item_id: string;
  level_id: string;
  micro_kp_id: string;
  kp_name: string;
  stem: string;
  options: unknown;
  answer: unknown;
  explain_correct: string | null;
  explain_wrong: string | null;
  spec: unknown;
  depth: number;
  ordinal: number;
  module_ordinal: number;
  module_id: string;
};

/** 题池快照里存的最小信息（够重建 `PlacementItem` 与回读题目）。 */
type PoolEntry = {
  itemId: string;
  microKpId: string;
  difficulty: PlacementDifficulty;
};

type SessionRow = {
  id: string;
  module_id: string | null;
  self_assessment: unknown;
  prior_shift: number;
  state: PlacementState;
  pool: PoolEntry[];
  answered: number;
  correct_count: number;
  tier: string | null;
  status: string;
  stop_reason: string | null;
  finished_at: Date | null;
};

type AnswerRow = {
  ordinal: number;
  item_id: string;
  level_id: string;
  micro_kp_id: string;
  difficulty: string;
  raw_answer: unknown;
  correct: boolean;
};

type ProfileRow = {
  tier: string;
  status: string;
  session_id: string | null;
  attempts_baseline: number;
  placed_at: Date;
  last_rejudge_id: string | null;
};

/**
 * 重判的两个输入。
 *
 * `totalAttempts` 是「累计计入掌握度的作答数」，用来判**门槛**（≥5 题）；
 * `averageFirstTryRate` 用来判**升降**。
 *
 * 两个量的职责不同，不能合并：门槛回答「有没有足够多的新证据可以重判」，
 * 升降回答「这些证据指向哪个档」。
 *
 * 这里曾经还有一个 `total`（已学完的知识点数）——门槛从知识点改成作答数之后
 * 就没有任何地方读它了。不删的话它就是第三个永远没人看的数：下一个人会
 * 以为「学完几个知识点」还在起作用，而实际上它在数学上已经被 5 题门槛完全
 * 覆盖（3 个知识点 ≥ 24 题，永远后到）。
 */
type LearnedKnowledge = {
  /** 累计「计入掌握度」的作答数（不看是否学完） */
  totalAttempts: number;
  averageFirstTryRate: number | null;
};

/** 一次重判的完整结果（手动接口与自动结算共用）。 */
type RejudgeOutcome = {
  previousTier: PlacementTier;
  tier: PlacementTier;
  /** 自上次定级/重判以来累计的作答数（触发门槛的那个数） */
  attemptsSince: number;
  averageFirstTryRate: number | null;
  explanation: string;
  at: string;
  /** 是否真的写入了（并发下可能被别人抢先，那就没有新记录） */
  applied: boolean;
};

/**
 * 题池规模上限。
 *
 * 18 题是停机上界，取 60 是为了让自适应选题有冗余：同一知识点往往有多道
 * 难度不同的题，池子太小会让 `selectPlacementItem` 每次都挑到同一道。
 * 60 也足够小，可以整块塞进 jsonb 快照。
 */
const POOL_LIMIT = 60;

/**
 * 知识点「学完」的门槛。
 *
 * 用 `PROFICIENT_THRESHOLD`（0.7）而不是 `MASTERY_THRESHOLD`（0.95）：
 * 「学完」是重判的触发条件，它要的是「这个知识点已经不再需要定级来判断」，
 * 而不是「已经彻底掌握」。要求 0.95 会让大多数人在 v1 里永远触发不了重判，
 * 验收第 5 条就变成一句空话。0.7 与 `RecommendService` 里「够用了」的判断
 * 同一条线，两处对「学会」的理解不会互相矛盾。
 */
const LEARNED_THRESHOLD = PROFICIENT_THRESHOLD;

/** 平均首轮正确率的升降级阈值（spec §D12：≥80% 上调、≤30% 下调）。 */
const PROMOTE_RATE = 0.8;
const DEMOTE_RATE = 0.3;

const TIER_ORDER: PlacementTier[] = ['P1', 'P2', 'P3'];

/**
 * 学习日志里「档位被重判」的事件名。
 *
 * 定义在这里而不是 `tier.service.ts`，因为**写入方是这个文件**：
 * `applyRejudge` 是升降级的唯一实现，读方（`TierService.changes`）依赖它。
 * 反过来把常量放读方会造出「写方 import 读方」的循环，而循环里的常量一旦
 * 某一侧被重命名，另一侧会默默读到 `undefined` 并把事件名写成字符串
 * `"undefined"` —— 那种行能写进库，只是永远查不出来。
 */
export const TIER_REJUDGE_EVENT = 'tier_rejudge';

/**
 * 题目难度从 `level.spec.items[].kind` 推。
 *
 * 这是一个**粗粒度假设**，不是标定结果：事实题（记住一个数值/定义）比
 * 综合题（要串几个关系）容易。engine 只需要「难题上高档更容易答对」这个
 * 方向成立，不需要难度是等距量 —— 三档 logit 本身就是粗的。
 *
 * 缺失 kind 时回落 `medium`：把不知道难度的题当成中等，比当成简单更难
 * 让后验被单题拉偏。
 */
const KIND_DIFFICULTY: Record<string, PlacementDifficulty> = {
  fact: 'easy',
  concept: 'medium',
  comprehensive: 'hard',
};

/** 从关卡 spec 里取某道题的 kind（与 `attempts.service.ts` 的私有函数同义）。 */
function kindOfItem(spec: unknown, itemId: string): string | null {
  if (typeof spec !== 'object' || spec === null) return null;
  const items = (spec as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const row = item as { id?: unknown; kind?: unknown };
    if (row.id === itemId && typeof row.kind === 'string') return row.kind;
  }
  return null;
}

function difficultyOf(spec: unknown, itemId: string): PlacementDifficulty {
  const kind = kindOfItem(spec, itemId);
  return (kind !== null && KIND_DIFFICULTY[kind]) || 'medium';
}

/** 把任意答案渲染成给学生看的文本。 */
function answerText(answer: unknown, options: unknown): string {
  if (typeof answer === 'number' && Array.isArray(options)) {
    const option = options[answer];
    return typeof option === 'string' ? option : `选项 ${answer + 1}`;
  }
  return typeof answer === 'string' ? answer : JSON.stringify(answer);
}

@Injectable()
export class PlacementService {
  private readonly logger = new Logger('Placement');

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** 读路径的执行器（不开事务）。 */
  private get runner(): Runner {
    return (sql, params) => this.db.query(sql, params ?? []);
  }

  // -------------------------------------------------------------------------
  // 行为自评
  // -------------------------------------------------------------------------

  /**
   * 自评问卷。
   *
   * 只回问题与选项文本，**不回权重**：权重是评分模型的内部参数，暴露出去
   * 等于邀请前端自己算先验，而「先验怎么影响档位」必须只有一处实现。
   */
  form(): SelfAssessmentFormResponse {
    return {
      questions: SELF_ASSESSMENT_QUESTIONS.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        options: question.options.map((option) => ({ id: option.id, label: option.label })),
      })),
      rationale:
        '这四道题问的是你最近**做过什么**，不是让你给自己打分。' +
        '自评与真实能力的关系并不稳定，所以它只用来把你的起点小幅挪动（最多半档），' +
        '真正的档位由接下来的定级题决定。',
    };
  }

  /**
   * 提交自评，得到起手先验。
   *
   * 校验两件事：每道题必须都答了、每个 optionId 必须在该题的选项里。
   * 缺一题就拒绝而不是「默认中间值」—— 默认值会让结果看起来是学生答的，
   * 而实际上系统替他答了一半。
   */
  submitSelfAssessment(request: SelfAssessmentSubmitRequest): SelfAssessmentSubmitResponse {
    const byQuestion = new Map(request.answers.map((answer) => [answer.questionId, answer.optionId]));
    for (const question of SELF_ASSESSMENT_QUESTIONS) {
      const chosen = byQuestion.get(question.id);
      if (chosen === undefined) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: `自评缺少第 ${question.id} 题的作答`,
          details: [{ path: ['selfAssessment'], message: `缺少 ${question.id}` }],
        });
      }
      if (!question.options.some((option) => option.id === chosen)) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: `第 ${question.id} 题的选项 ${chosen} 不存在`,
          details: [{ path: ['selfAssessment'], message: `未知选项 ${chosen}` }],
        });
      }
    }
    const state = initialPlacementState(request.answers);
    return {
      priorShift: state.priorShift,
      priorProbabilities: tierProbabilities(state),
    };
  }

  // -------------------------------------------------------------------------
  // 题池
  // -------------------------------------------------------------------------

  /**
   * 取「即将要学的知识点」里已有题的题池。
   *
   * ## 为什么必须限定在「即将要学的」
   *
   * 票 11 验收 2 的原文：「定级题必须来自用户马上要学的知识点池，不是通用
   * 题库 —— 否则定完级学的内容和定级内容无关」。用通用题库的后果不是抽象
   * 的：人会在定级里被考「卡诺图化简」，然后被安排去学「前置放大器的噪声」，
   * 两件事毫无关系，定级结果对他接下来的学习没有任何预测力。
   *
   * ## 「即将要学」怎么判定
   *
   * 叶节点 + **没有真实学习证据把它推到「学完」**。
   *
   * ### 为什么不读 `app.mastery`
   *
   * 这里曾经是 `LEFT JOIN mastery ms ... ms.state IN ('unseen','attempted')`。
   * 那是在读快照列，而本项目的规矩是 **canonical = `attempts` 回放**，
   * `app.mastery` 只是派生缓存 —— `mastery.service.ts` 的文件头写得很清楚：
   * `current` 会随时间衰减，读列等于把「上次算的时刻」当成「现在」。
   *
   * 具体后果不是抽象的：`app.mastery` 目前是 0 行（所有叶节点都落在
   * `ms.state IS NULL`），这条过滤现在等于没过滤；等有人写入 mastery 之后
   * 它才开始生效，那时才会出现「明明答过题却还被当没学过」或反过来的错判，
   * 而那时已经没人记得这里读过快照。
   *
   * 所以先取出候选，再用与掌握度接口同一套 `snapshotOf` 回放淘汰已学完的
   * 知识点（`attempts` 为空 = 一行证据都没有 = 当然还在池里）。
   *
   * **不按模块顺序截断**：学习者可能从任何模块开始，把题池限制在「最小的
   * 那个模块」会让定级只考一个主题，档位就退化成「这个主题学得怎么样」。
   * 排序按 (模块序, 深度, 序) 只为**确定性** —— 同一份数据每次得到的题池
   * 相同，测试才能断言具体值。
   */
  private async loadCandidates(): Promise<CandidateRow[]> {
    const rows = (await this.db.query<CandidateRow>(
      `SELECT li.id            AS item_id,
              li.level_id,
              l.micro_kp_id,
              n.name           AS kp_name,
              li.stem,
              li.options,
              li.answer,
              li.explain_correct,
              li.explain_wrong,
              l.spec,
              n.depth,
              n.ordinal,
              m.ordinal        AS module_ordinal,
              m.id             AS module_id
         FROM level_items li
         JOIN levels l          ON l.id = li.level_id
         JOIN knowledge_points n ON n.id = l.micro_kp_id
         JOIN modules m         ON m.id = n.module_id
        WHERE n.is_leaf = true
        ORDER BY m.ordinal, n.depth, n.ordinal, li.id`,
    )) as CandidateRow[];

    const learned = await this.learnedMicroKpIds(rows.map((row) => row.micro_kp_id));
    if (learned.size === 0) return rows.slice(0, POOL_LIMIT);
    return rows.filter((row) => !learned.has(row.micro_kp_id)).slice(0, POOL_LIMIT);
  }

  /**
   * 哪些知识点已经「学完」——按 `attempts` 回放算，不读 `app.mastery` 快照列。
   *
   * 判据与 `learnedKnowledge()` 一致：`evidenceSufficient && achieved >= 0.7`。
   * 两处必须同源，否则会出现「题池说这题还没学、重判说这个知识点已学完」
   * 这种相互矛盾的结论。
   */
  private async learnedMicroKpIds(microKpIds: readonly string[]): Promise<Set<string>> {
    const ids = [...new Set(microKpIds)];
    if (ids.length === 0) return new Set();
    const evidence = await loadEvidence(this.runner, ids);
    if (evidence.length === 0) return new Set();
    const grouped = groupByMicroKp(evidence);
    const evaluatedAt = await this.db.now();
    const learned = new Set<string>();
    for (const [microKpId, events] of grouped) {
      const snapshot = snapshotOf(events, evaluatedAt);
      if (!snapshot.evidenceSufficient) continue;
      if (snapshot.achieved === null || snapshot.achieved < LEARNED_THRESHOLD) continue;
      learned.add(microKpId);
    }
    return learned;
  }

  /** 题池快照里每条记录的完整题面（回读用，避免每题重新查库）。 */
  private async loadPoolItems(entries: readonly PoolEntry[]): Promise<Map<string, CandidateRow>> {
    if (entries.length === 0) return new Map();
    const ids = entries.map((entry) => entry.itemId);
    const rows = (await this.db.query<CandidateRow>(
      `SELECT li.id            AS item_id,
              li.level_id,
              l.micro_kp_id,
              n.name           AS kp_name,
              li.stem,
              li.options,
              li.answer,
              li.explain_correct,
              li.explain_wrong,
              l.spec,
              n.depth,
              n.ordinal,
              m.ordinal        AS module_ordinal,
              m.id             AS module_id
         FROM level_items li
         JOIN levels l          ON l.id = li.level_id
         JOIN knowledge_points n ON n.id = l.micro_kp_id
         JOIN modules m         ON m.id = n.module_id
        WHERE li.id = ANY($1::text[])`,
      [ids],
    )) as unknown as CandidateRow[];
    return new Map(rows.map((row) => [row.item_id, row]));
  }

  // -------------------------------------------------------------------------
  // 会话
  // -------------------------------------------------------------------------

  /** 开一次定级。 */
  async start(request: PlacementStartRequest): Promise<PlacementSessionResponse> {
    const prior = this.submitSelfAssessment({ answers: request.selfAssessment });
    const candidates = await this.loadCandidates();
    if (candidates.length === 0) {
      throw new ConflictException({
        code: 'CONFLICT',
        message:
          '现在还没有可以定级的题目。定级题来自你接下来要学的知识点，' +
          '等这些知识点有了题目之后再来定级。',
      });
    }

    const pool: PoolEntry[] = candidates.map((row) => ({
      itemId: row.item_id,
      microKpId: row.micro_kp_id,
      difficulty: difficultyOf(row.spec, row.item_id),
    }));

    // 自评 + 初始状态：`initialPlacementState` 内部会重算平移量，
    // 这里把同一份自评再传一次是为了让「状态里记着自评」这件事只有一条路径。
    const state = initialPlacementState(request.selfAssessment);
    const sessionId = `plc-${randomUUID()}`;
    // 起手聚焦模块：取题池第一道题所属模块，仅用于复盘（不参与选题）。
    const moduleId = candidates[0]?.module_id ?? null;

    await this.db.query(
      `INSERT INTO placement_sessions
         (id, module_id, self_assessment, prior_shift, state, pool, answered, correct_count)
       VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6::jsonb, 0, 0)`,
      [
        sessionId,
        moduleId,
        JSON.stringify(request.selfAssessment),
        prior.priorShift,
        JSON.stringify(state),
        JSON.stringify(pool),
      ],
    );

    this.logger.log(`定级会话 ${sessionId} 开始：题池 ${pool.length} 道，先验平移 ${prior.priorShift.toFixed(2)}`);
    return this.sessionView(sessionId);
  }

  /** 读会话当前状态（刷新页面靠它恢复）。 */
  async sessionView(sessionId: string): Promise<PlacementSessionResponse> {
    const row = await this.loadSession(sessionId);
    const pool = row.pool;
    const items: PlacementItem[] = pool.map((entry) => ({
      itemId: entry.itemId,
      microKpId: entry.microKpId,
      difficulty: entry.difficulty,
    }));
    const state = row.state;
    const stop = placementStop(state, { remainingItems: this.remaining(items, state) });
    // 结束条件已满足、或题池已无没问过的题 → 这一轮不再出题
    const next = stop.stopped ? null : selectPlacementItem(state, items);
    const remaining = this.remaining(items, state);

    let item: PlacementItemView | null = null;
    if (next !== null) {
      const detail = (await this.loadPoolItems([{ itemId: next.itemId, microKpId: next.microKpId, difficulty: next.difficulty }])).get(next.itemId);
      if (detail) {
        item = {
          itemId: detail.item_id,
          microKpId: detail.micro_kp_id,
          microKpName: detail.kp_name,
          stem: detail.stem,
          options: Array.isArray(detail.options) ? detail.options.map((option) => String(option)) : [],
          difficulty: next.difficulty,
        };
      }
    }

    return {
      sessionId: row.id,
      item,
      answered: row.answered,
      correctCount: row.correct_count,
      probabilities: tierProbabilities(state),
      posteriorSd: posteriorStandardDeviation(state),
      stop: { stopped: stop.stopped, reason: stop.reason },
      remainingItems: remaining,
    };
  }

  /**
   * 提交一道定级题的作答。
   *
   * 判分复用 `judgeAnswer`（与关卡作答同一个函数）：两套判分逻辑早晚会在
   * 「空格算不算对」「大小写要不要折叠」上分叉，而学习者会立刻发现同一道题
   * 在两个页面得到不同判定。
   */
  async answer(sessionId: string, request: PlacementAnswerRequest): Promise<PlacementAnswerResponse> {
    const row = await this.loadSession(sessionId);
    if (row.status === 'finished') {
      throw new ConflictException({
        code: 'CONFLICT',
        message: '这次定级已经结束，可以查看结果，或重新开始一次定级。',
      });
    }

    const entry = row.pool.find((candidate) => candidate.itemId === request.itemId);
    if (!entry) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `这道题不属于本次定级: ${request.itemId}`,
      });
    }

    const detail = (await this.loadPoolItems([entry])).get(entry.itemId);
    if (!detail) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `定级题已经不在题库里了: ${request.itemId}`,
      });
    }

    // 选项下标越界要单独判 422 而不是让它走到 judgeAnswer 的 invalid：
    // 前者是「你发了不存在的选项」（客户端的错），后者是「这道题的数据坏了」
    // （内容侧的错），前端需要能区分要不要提示重选题。
    const total = optionCount(detail.options);
    if (typeof request.answer === 'number' && total > 0 && request.answer >= total) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: `选项下标 ${request.answer} 超出这道题的选项个数 ${total}`,
      });
    }

    const judgement = judgeAnswer(detail.answer, request.answer);
    if (judgement.verdict === 'invalid') {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: judgement.reason,
      });
    }
    const correct = judgement.verdict === 'correct';

    const state = recordPlacementAnswer(row.state, entry, correct);
    const answered = row.answered + 1;
    const correctCount = row.correct_count + (correct ? 1 : 0);
    const stop = placementStop(
      state,
      { remainingItems: this.remaining(row.pool.map((candidate) => this.toItem(candidate)), state) },
    );

    await this.db.query(
      `INSERT INTO placement_answers
         (session_id, ordinal, item_id, level_id, micro_kp_id, difficulty, raw_answer, correct)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        sessionId,
        answered,
        entry.itemId,
        detail.level_id,
        entry.microKpId,
        entry.difficulty,
        JSON.stringify(request.answer),
        correct,
      ],
    );

    if (stop.stopped) {
      const result = placementResult(state);
      await this.db.query(
        `UPDATE placement_sessions
            SET state = $2::jsonb, answered = $3, correct_count = $4,
                tier = $5, status = 'finished', stop_reason = $6,
                finished_at = now(), updated_at = now()
          WHERE id = $1`,
        [sessionId, JSON.stringify(state), answered, correctCount, result.tier, stop.reason],
      );
      await this.upsertProfile(result.tier, sessionId);
    } else {
      await this.db.query(
        `UPDATE placement_sessions
            SET state = $2::jsonb, answered = $3, correct_count = $4, updated_at = now()
          WHERE id = $1`,
        [sessionId, JSON.stringify(state), answered, correctCount],
      );
    }

    return {
      itemId: entry.itemId,
      correct,
      correctAnswer: detail.answer as number | string,
      correctAnswerText: answerText(detail.answer, detail.options),
      explanation: detail.explain_correct,
      whyWrong: correct ? null : detail.explain_wrong,
      session: await this.sessionView(sessionId),
    };
  }

  /**
   * 定级结果。
   *
   * 未结束时 409：结果页不该在答到一半时展示一个还会变的档位 —— 学生会
   * 记住那个数字，而它随后会变，那比不给看更糟。
   */
  async result(sessionId: string): Promise<PlacementResultResponse> {
    const row = await this.loadSession(sessionId);
    if (row.status !== 'finished') {
      throw new ConflictException({
        code: 'CONFLICT',
        message: '这次定级还没结束，答完剩下的题再看结果。',
      });
    }

    const answers = (await this.db.query<AnswerRow>(
      `SELECT ordinal, item_id, level_id, micro_kp_id, difficulty, raw_answer, correct
         FROM placement_answers
        WHERE session_id = $1
        ORDER BY ordinal ASC`,
      [sessionId],
    )) as unknown as AnswerRow[];

    const details = await this.loadPoolItems(
      answers.map((answer) => ({
        itemId: answer.item_id,
        microKpId: answer.micro_kp_id,
        difficulty: answer.difficulty as PlacementDifficulty,
      })),
    );

    // 逐题复核表（票 11 验收 4）：正确答案与「你选了什么」并排，学习者才能
    // 判断系统有没有把自己判错。**不含**解析 —— 解析太长，逐题铺开会把结果页
    // 变成一堵墙；解析在作答那一刻已经给过了（`PlacementAnswerResponse`）。
    const review: PlacementReviewItem[] = answers.map((answer) => {
      const detail = details.get(answer.item_id);
      return {
        itemId: answer.item_id,
        microKpId: answer.micro_kp_id,
        stem: detail?.stem ?? '（这道题已从题库移除）',
        yourAnswerText: answerText(answer.raw_answer, detail?.options),
        correctAnswerText: answerText(detail?.answer, detail?.options),
        correct: answer.correct,
        difficulty: answer.difficulty as PlacementDifficulty,
      };
    });

    const result = placementResult(row.state);
    const tier = result.tier as PlacementTier;

    return {
      sessionId,
      tier,
      status: 'provisional',
      confidence: result.confidence,
      lowConfidence: result.lowConfidence,
      probabilities: result.probabilities,
      answered: row.answered,
      correctCount: row.correct_count,
      stopReason: (row.stop_reason as PlacementResultResponse['stopReason']) ?? null,
      review,
      rejudgeAfterAttempts: PLACEMENT_LIMITS.rejudgeAfterAttempts,
      explanation: this.explainResult(tier, row.answered, row.correct_count, result.lowConfidence, row.stop_reason),
    };
  }

  // -------------------------------------------------------------------------
  // 状态与重判
  // -------------------------------------------------------------------------

  /**
   * 当前档位状态。**这里也是「自动重判」发生的地方。**
   *
   * ## 为什么自动重判是「读的时候算」而不是定时任务
   *
   * 票 11 验收 5 要求「学满 3 个知识点后**自动**重判」。做法有三种：
   * 定时扫全库、学习动作里挂副作用、读状态时结算。选第三种：
   *
   * - 定时任务要为「一个可能永远不发生的转换」养一个调度器，且重判时刻
   *   会随服务器重启漂移；
   * - 在学习动作（`AttemptsService.record`）里插副作用，会把定级的写入
   *   塞进每一次作答的事务里 —— 作答是热路径，重判是低频事件，代价与收益
   *   不相称，而且答一道题就要多算一遍全库知识点；
   * - 读状态时结算：只在有人真的要看档位时才算，算完立刻落库。学习者
   *   下次打开页面（或任何客户端调 `GET /api/v1/placement`）看到的就是
   *   已修正的档位，不需要点任何按钮。
   *
   * 「自动」的定义因此是**系统行为**：不依赖某个客户端的按钮。CLI、文档、
   * 将来的移动端只要读状态，就会拿到同一份结论。
   *
   * ## 幂等
   *
   * 结算完立刻把 `attempts_baseline` 前移到当前作答总数，于是下一次读
   * `since` 变成 0，不会再触发。并发下两个请求可能都判断为「该重判」——用
   * `UPDATE ... WHERE last_rejudge_id IS NOT DISTINCT FROM $2` 这类乐观锁
   * 没必要：档位只会被执行两次同样的计算得到同样的结果，第二次多一条
   * 日志而已。真正需要防的是「同一次学习证据被算两遍导致跳两档」，而
   * `attempts_baseline` 前移已经把它挡住了（第二次 `since` 为 0）。
   */
  async status(): Promise<PlacementStatusResponse> {
    const profile = await this.loadProfile();
    if (!profile) {
      const learned = await this.learnedKnowledge();
      return {
        tier: null,
        status: 'none',
        placedAt: null,
        rejudgeAfterAttempts: PLACEMENT_LIMITS.rejudgeAfterAttempts,
        attemptsSince: learned.totalAttempts,
        shouldRejudge: false,
        lastRejudge: null,
      };
    }

    let learned = await this.learnedKnowledge();
    let current = profile;
    let since = Math.max(0, learned.totalAttempts - current.attempts_baseline);

    // 自动结算：门槛一到就在这次读取里完成，用户不需要点按钮。
    if (shouldRejudge({ status: 'provisional', attemptsSince: since })) {
      await this.applyRejudge(current, learned);
      // 重新读一遍：档位、基线、last_rejudge_id 都变了。
      current = (await this.loadProfile()) ?? current;
      learned = await this.learnedKnowledge();
      since = Math.max(0, learned.totalAttempts - current.attempts_baseline);
    }

    const history = await this.loadRejudgeEvent(current.last_rejudge_id);
    return {
      tier: current.tier as PlacementTier,
      status: 'provisional',
      // `placedAt` 是「档位最后一次变动的时刻」：重判过就是重判的时刻，否则
      // 是定级的时刻。**必须走 toISOString** —— `Date.prototype.toString()`
      // 会给出 `Wed Oct 21 2026 05:08:10 GMT+0800 (中国标准时间)`，Zod 的
      // `z.string()` 只检查是不是字符串，这种本地化格式能过契约检查、
      // 到前端 `new Date(...)` 才乱，属于最难查的一类。
      placedAt: history ? history.at : current.placed_at.toISOString(),
      rejudgeAfterAttempts: PLACEMENT_LIMITS.rejudgeAfterAttempts,
      attemptsSince: since,
      // 正常路径下这里必然是 false（上面已经结算过）。只有并发下另一个
      // 请求刚好把基线前移了、而这个请求读到的是旧快照时才会是 true。
      shouldRejudge: shouldRejudge({ status: 'provisional', attemptsSince: since }),
      lastRejudge: history,
    };
  }

  /**
   * 用学习证据重判（手动接口）。
   *
   * 票 11 验收 5：学习之后用真实证据重判并可升降级。重判**不重考**
   * ——重考一遍只会得到同一批人同样的结果，还多一次挫败；要修正的是最初
   * 那 8–18 题的判断，而学习过程中产生的作答才是关于「他实际学得怎么样」
   * 的证据。
   *
   * 门槛口径是**累计作答数**（≥ `rejudgeAfterAttempts`，spec 两处都是学
   * 5 题），不是「学完几个知识点」：`evidenceSufficient` 要求 8 题 + 3 变式，
   * 新人做完 5 题时一个知识点都还没「学完」，按知识点计数等于让重判在最初
   * 几天永远不触发 —— 恰是定级最容易判错的那段时间。
   *
   * 自动结算已经会在读状态时发生，这个接口保留给两种场景：客户端想显式
   * 触发（例如学习结束后立刻刷新档位，而不等下一次读），以及门槛刚够时
   * 前端手里的旧快照。两条路径**共用 `applyRejudge`** —— 复制一份升降级
   * 规则会出现「自动判的和手动判的不一样」这种最难查的 bug。
   */
  async rejudge(): Promise<PlacementRejudgeResponse> {
    const profile = await this.loadProfile();
    if (!profile) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: '还没有定级结果，先做一次定级再来重判。',
      });
    }
    const learned = await this.learnedKnowledge();
    const since = Math.max(0, learned.totalAttempts - profile.attempts_baseline);
    if (!shouldRejudge({ status: 'provisional', attemptsSince: since })) {
      throw new ConflictException({
        code: 'CONFLICT',
        message:
          `还需要再答 ${Math.max(0, PLACEMENT_LIMITS.rejudgeAfterAttempts - since)} 题才能重判。` +
          `重判依据是真实学习证据，不是重考一遍定级题。`,
      });
    }

    const outcome = await this.applyRejudge(profile, learned);
    return {
      tier: outcome.tier,
      previousTier: outcome.previousTier,
      changed: outcome.tier !== outcome.previousTier,
      attemptsSince: outcome.attemptsSince,
      averageFirstTryRate: outcome.averageFirstTryRate,
      explanation: outcome.explanation,
      placedAt: outcome.at,
    };
  }

  /**
   * 升降级规则的**唯一实现**（自动结算与手动接口都走这里）。
   *
   * 规则取自 spec §D12：平均首轮正确率 ≥80% 上调一档、≤30% 下调一档。
   * 只在门槛满足时变更，且**每次最多动一档**：一次重判跳两档会让「我这一周
   * 学了 3 个知识点」变成「我被重新归类成另一个人」。
   *
   * 写库顺序：先插日志拿到 id，再把 `placement_profile` 指过去。反过来会
   * 出现「档案指向一条还不存在的日志」的窗口。
   */
  private async applyRejudge(profile: ProfileRow, learned: LearnedKnowledge): Promise<RejudgeOutcome> {
    const current = profile.tier as PlacementTier;
    const index = TIER_ORDER.indexOf(current);
    let next = current;
    if (learned.averageFirstTryRate !== null) {
      if (learned.averageFirstTryRate >= PROMOTE_RATE && index < TIER_ORDER.length - 1) {
        next = TIER_ORDER[index + 1] as PlacementTier;
      } else if (learned.averageFirstTryRate <= DEMOTE_RATE && index > 0) {
        next = TIER_ORDER[index - 1] as PlacementTier;
      }
    }

    const since = Math.max(0, learned.totalAttempts - profile.attempts_baseline);
    const explanation = this.explainRejudge(current, next, since, learned.averageFirstTryRate);

    // 三条写库放在一个事务里。它们原本只是「先写日志再指过去」两步，现在多
    // 了学习日志（票 12 验收 3 要求学习者能看到「为什么给我降档了」）。两份
    // 日志必须同时存在或同时不存在：`/tier/changes` 读的是 `learning_log`，
    // `/placement` 读的是 `placement_rejudges`，只写成一处的后果是「档位页面
    // 说被降过级，变更历史里一条都没有」—— 这种不一致没有任何后台任务能修。
    const client = await this.db.connection.connect();
    let record: { id: string; created_at: Date } | undefined;
    try {
      await client.query('BEGIN');
      const run: Runner = async (sql, params) => {
        const result = await client.query(sql, params as unknown[]);
        return result.rows as Record<string, unknown>[];
      };

      const inserted = await run(
        `INSERT INTO placement_rejudges
           (previous_tier, tier, attempts_since, average_first_try_rate, explanation)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, created_at`,
        [current, next, since, learned.averageFirstTryRate, explanation],
      );
      record = inserted[0] as unknown as { id: string; created_at: Date } | undefined;
      if (!record) throw new Error('重判日志写入失败：没有返回行');

      // **乐观锁**：只有「基线还是我读到的那个值」时才允许前移。
      //
      // 没有这个条件时，同一批并发读（浏览器一次刷新就会并行发好几个
      // `/placement`）全部看到旧基线、全部判断「该重判」、全部提交成功 ——
      // 实测 88 条日志里只有 41 个不同秒，最多 4 条完全重复（`04:59:00`
      // 一次四条、内容一字不差），档位历史页因此把同一次重判显示成 4 行。
      //
      // 注释里原先写的「第二次 `since` 为 0 已经挡住」只对**顺序**调用成立：
      // 并发下四家都在任何一家 COMMIT 之前读到了旧基线。改条件更新后，
      // 第一个提交者前移基线，其余三家的 UPDATE 匹配 0 行 ⇒ ROLLBACK，
      // 连同刚插入的那条日志一起撤销，只剩一行。
      const advanced = await run(
        `UPDATE placement_profile
            SET tier = $1,
                attempts_baseline = $2,
                placed_at = now(),
                last_rejudge_id = $3,
                updated_at = now()
          WHERE id = 1
            AND attempts_baseline = $4
        RETURNING id`,
        [next, learned.totalAttempts, record.id, profile.attempts_baseline],
      );

      if (advanced.length === 0) {
        // 别人已经结算过这次重判。撤销本次插入，读回对方的结果。
        await client.query('ROLLBACK');
        const winner = await this.loadProfile();
        const history = await this.loadRejudgeEvent(winner?.last_rejudge_id ?? null);
        return {
          previousTier: history?.previousTier ?? current,
          tier: (winner?.tier as PlacementTier) ?? next,
          attemptsSince: since,
          averageFirstTryRate: learned.averageFirstTryRate,
          explanation: history?.explanation ?? explanation,
          at: history?.at ?? new Date().toISOString(),
          applied: false,
        };
      }

      // `micro_kp_id` 留 NULL：档位不是某个知识点的属性。写一个「最相关的
      // 知识点」会让 `log_kp_idx` 上多出一条与该知识点无关的事件，回看某张
      // 关卡的门控历史时混进来一句「你的档位变了」。
      await run(
        `INSERT INTO learning_log (session_id, micro_kp_id, event, payload)
         VALUES (NULL, NULL, $1, $2::jsonb)`,
        [
          TIER_REJUDGE_EVENT,
          JSON.stringify({
            previousTier: current,
            tier: next,
            changed: next !== current,
            attemptsSince: since,
            averageFirstTryRate: learned.averageFirstTryRate,
            explanation,
          }),
        ],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    return {
      previousTier: current,
      tier: next,
      attemptsSince: since,
      averageFirstTryRate: learned.averageFirstTryRate,
      explanation,
      at: record.created_at.toISOString(),
      applied: true,
    };
  }

  /** 读一条重判日志，翻成契约形状。 */
  private async loadRejudgeEvent(id: string | null): Promise<PlacementRejudgeEvent | null> {
    if (id === null) return null;
    const rows = await this.db.query<{
      previous_tier: string;
      tier: string;
      attempts_since: number;
      average_first_try_rate: number | null;
      explanation: string;
      created_at: Date;
    }>(
      `SELECT previous_tier, tier, attempts_since, average_first_try_rate, explanation, created_at
         FROM placement_rejudges
        WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    const previousTier = row.previous_tier as PlacementTier;
    const tier = row.tier as PlacementTier;
    return {
      previousTier,
      tier,
      changed: tier !== previousTier,
      attemptsSince: row.attempts_since,
      averageFirstTryRate: row.average_first_try_rate,
      explanation: row.explanation,
      at: row.created_at.toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------

  private toItem(entry: PoolEntry): PlacementItem {
    return { itemId: entry.itemId, microKpId: entry.microKpId, difficulty: entry.difficulty };
  }

  /** 题池里还没问过的题数。 */
  private remaining(items: readonly PlacementItem[], state: PlacementState): number {
    const asked = new Set(state.history.map((entry) => entry.itemId));
    return items.filter((item) => !asked.has(item.itemId)).length;
  }

  private async loadSession(sessionId: string): Promise<SessionRow> {
    const rows = await this.db.query<SessionRow>(
      `SELECT id, module_id, self_assessment, prior_shift, state, pool,
              answered, correct_count, tier, status, stop_reason, finished_at
         FROM placement_sessions
        WHERE id = $1`,
      [sessionId],
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `定级会话不存在: ${sessionId}`,
      });
    }
    return row;
  }

  private async loadProfile(): Promise<ProfileRow | undefined> {
    const rows = await this.db.query<ProfileRow>(
      `SELECT tier, status, session_id, attempts_baseline, placed_at, last_rejudge_id
         FROM placement_profile
        WHERE id = 1`,
    );
    return rows[0];
  }

  /**
   * 写入/更新当前档位。
   *
   * `attempts_baseline` 记的是**定级那一刻**已累计的作答数（基线）。
   * 之后「自上次定级以来答了几题」靠现算总数减基线得到。存基线而不是存
   * 差值，是因为差值需要每次学习完都去更新它 —— 那就要在学习链路上插一个
   * 副作用，而定级完全可以在读的时候算。
   *
   * `last_rejudge_id` 在这里**清空**：重新定级产生的是一个全新的 baseline，
   * 上一次重判的「P1 → P2」属于上一轮定价的历史，继续挂在档案上会让界面
   * 显示一条与本轮无关的结论。
   */
  private async upsertProfile(tier: string, sessionId: string): Promise<void> {
    const learned = await this.learnedKnowledge();
    await this.db.query(
      `INSERT INTO placement_profile (id, tier, status, session_id, attempts_baseline, placed_at, updated_at, last_rejudge_id)
       VALUES (1, $1, 'provisional', $2, $3, now(), now(), NULL)
       ON CONFLICT (id) DO UPDATE
          SET tier = EXCLUDED.tier,
              status = 'provisional',
              session_id = EXCLUDED.session_id,
              attempts_baseline = EXCLUDED.attempts_baseline,
              placed_at = now(),
              updated_at = now(),
              last_rejudge_id = NULL`,
      [tier, sessionId, learned.totalAttempts],
    );
  }

  /**
   * 重判需要的两个数：累计作答数、平均首轮正确率。
   *
   * ## 为什么两个计数都要
   *
   * 门槛用**作答数**（spec.md:52 / :283「学 5 题后可重判」），升降用
   * **首轮正确率**。票面那句「学满 3 个知识点后自动重判」是从票 12 抄错的
   * （spec.md:281 的「每完成 3 个知识点重评」是流程重评，与本票的定级重判
   * 是两件事）。用知识点数判门槛会让重判在最初几天永远不触发 —— 一个刚开始
   * 学的新人做完 5 题时，一个知识点都还没「学完」。
   *
   * ## 「学完」的判据
   *
   * `evidenceSufficient && achieved >= 0.7`：证据足够（至少 8 题 / 3 变式）
   * 才有资格谈「学完」，否则做了 2 道题就 100% 会把所有人误判成学会了。
   *
   * ## 「首轮正确率」按知识点算，不按题算
   *
   * 一个知识点算一次：只取它的第一次作答。按题算会让「同一个知识点刷了
   * 20 道简单题」的人拉高整条比率，而我们要知道的是「他第一次接触一个
   * 知识点时能不能做对」。
   */
  private async learnedKnowledge(): Promise<LearnedKnowledge> {
    // 门槛的计数与「哪些知识点有证据」是两件事：学完一个知识点需要 8 题，
    // 而门槛是 5 题 —— 后者在绝大多数时候都更大。所以这条 COUNT 不能从
    // 上面的 DISTINCT 里推（那会把「做了 5 题但一个知识点都没学完」的人
    // 算成 0）。
    const counters = await this.db.query<{ total_attempts: string }>(
      `SELECT count(*)::text AS total_attempts
         FROM attempts
        WHERE counts_toward_mastery = true`,
    );
    const totalAttempts = Number(counters[0]?.total_attempts ?? '0');

    const rows = await this.db.query<{ micro_kp_id: string }>(
      `SELECT DISTINCT micro_kp_id
         FROM attempts
        WHERE counts_toward_mastery = true`,
    );
    const ids = rows.map((row) => row.micro_kp_id);
    if (ids.length === 0) return { totalAttempts, averageFirstTryRate: null };

    const evidence = await loadEvidence(this.runner, ids);
    const grouped = groupByMicroKp(evidence);
    const evaluatedAt = await this.db.now();

    let firstTryCorrect = 0;
    let firstTrySample = 0;
    for (const events of grouped.values()) {
      const snapshot = snapshotOf(events, evaluatedAt);
      if (!snapshot.evidenceSufficient) continue;
      if (snapshot.achieved === null || snapshot.achieved < LEARNED_THRESHOLD) continue;
      // events 已按 `created_at, id` 升序取回（`loadEvidence` 的 ORDER BY）
      const first = events[0];
      if (first) {
        firstTrySample += 1;
        if (first.correct) firstTryCorrect += 1;
      }
    }

    return {
      totalAttempts,
      averageFirstTryRate: firstTrySample === 0 ? null : firstTryCorrect / firstTrySample,
    };
  }

  private explainResult(
    tier: PlacementTier,
    answered: number,
    correctCount: number,
    lowConfidence: boolean,
    stopReason: string | null,
  ): string {
    const reasonText: Record<string, string> = {
      sd: '系统对档位的判断已经足够确定',
      band: '最近几题的正确率稳定在中间区间，再多问也分不出档位',
      entropy: '新题目已经推不动判断',
      max_items: '已经问满 18 题',
      no_more_items: '题池里的题已经问完',
    };
    const stop = stopReason === null ? '这次定级已经结束' : (reasonText[stopReason] ?? '这次定级已经结束');
    const head = `你答了 ${answered} 道题，答对 ${correctCount} 道，${stop}，因此定为 ${tier}。`;
    if (!lowConfidence) {
      return `${head}这个结果是临时的：再答 ${PLACEMENT_LIMITS.rejudgeAfterAttempts} 题后会用你的真实学习数据重新判断，可能升也可能降。`;
    }
    return (
      `${head}不过这次的结果**置信度不高**（题量偏少或答案摇摆），请把它当成一个起点而不是结论。` +
      `再答 ${PLACEMENT_LIMITS.rejudgeAfterAttempts} 题后会自动重判。`
    );
  }

  private explainRejudge(
    previous: PlacementTier,
    next: PlacementTier,
    attemptsSince: number,
    rate: number | null,
  ): string {
    const rateText = rate === null ? '暂时算不出平均首轮正确率' : `平均首轮正确率 ${Math.round(rate * 100)}%`;
    // 算不出首轮正确率时，必须说清「系统在等什么」，而且不能沿用「这个表现与
    // P2 相符」那半句 —— 既然算不出，就无从谈起「相符」，那是另一句假话。
    //
    // 真正的等待条件是「至少一个知识点达到已熟练」—— 那需要
    // `evidenceSufficient`（8 题 + 3 种变式）且 achieved ≥ 0.7。这不是实现
    // 细节，而是这条反馈的全部意义：让学习者知道再答多少、怎么答才算数。
    if (rate === null) {
      return (
        `你在上次定级后又答了 ${attemptsSince} 题，但暂时算不出平均首轮正确率：` +
        `重判需要至少一个知识点达到「已熟练」（要 ${MASTERY_MIN_ATTEMPTS} 题 + ${MASTERY_MIN_VARIANTS} 种变式），目前还没有。` +
        `在那之前档位保持不动。`
      );
    }
    if (next === previous) {
      return `你在上次定级后又答了 ${attemptsSince} 题，${rateText}。这个表现与 ${previous} 相符，档位不变。`;
    }
    const direction = TIER_ORDER.indexOf(next) > TIER_ORDER.indexOf(previous) ? '上调' : '下调';
    return `你在上次定级后又答了 ${attemptsSince} 题，${rateText}，因此把档位${direction}一档：${previous} → ${next}。`;
  }
}
