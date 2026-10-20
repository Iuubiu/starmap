import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ProbeSessionResponseSchema,
  ProbeTurnResponseSchema,
  ProbeMetricsResponseSchema,
  type ProbeSessionResponse,
  type ProbeTurnResponse,
  type ProbeMetricsResponse,
  type LearnerTier,
  type ProbeReplyKindName,
  type ProbeLadderSnapshot,
} from '@starmap/api-contract';
import {
  LADDER_LEVELS,
  classifyReply,
  initialLadderState,
  judgeProbeReply,
  ladderCap,
  nextLadder,
  type LadderAction,
  type LadderLevel,
  type LadderState,
  type ProbeJudgeVerdict,
} from '@starmap/engine';
import { DatabaseService } from '../db/database.service.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import { LLM_PORT, type LlmPort } from '../llm/llm.port.js';

/**
 * 苏格拉底追问的状态机服务（票 10）。
 *
 * ## 分工：策略核心在 engine，措辞在模型
 *
 * `packages/engine/src/probe-ladder.ts` 是纯函数，它决定**这一轮能用到第几级**
 * ——那由学习者档位（P1/P2/P3）决定，模型无权越过。模型在这里只做两件
 * 不改变策略的事：
 *
 * 1. 判断学习者的回答是「对」「部分对」还是「错」（这是**理解**，不是策略）；
 * 2. 把已经定下来的动作措辞成一个具体问题（这是**表达**）。
 *
 * 这样「不得无限追问」「不得直接给答案」是代码结构保证的，不是提示词愿望。
 *
 * ## 为什么问题还要过 judge
 *
 * 措辞会走样：模型完全可能把「提示第 2 级」写成「其实就是 R = V/I，你算一下？」
 * —— 策略没错，输出越界了。所以每一句将要展示给学习者的话都要过
 * `judgeProbeReply`，越界则**退回策略核心自己生成的安全问句**。
 * 越界不算失败：回合照常完成，但会留痕，`/agent/probes/metrics` 能按
 * 拒绝原因统计占比。
 *
 * ## 为什么「判对错」失败时归为 partial
 *
 * 如果评分模型调用失败，把回答当成 `wrong` 会冤枉学生（降级掉太快），
 * 当成 `correct` 会放水（阶梯清空）。`partial` 在 ladder 里的语义恰好是
 * 「不升不降，换个问法再试一次」，是唯一不改变策略状态的落点。
 */

/** 追问里的一次回复：模型只回答「对不对」，不参与「下一步做什么」。 */
const GRADE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['correct', 'partial', 'wrong'] },
    reason: { type: 'string' },
  },
  required: ['verdict'],
} as const;

/** 措辞请求：**只给动作，不给答案**。 */
const PHRASE_SCHEMA = {
  type: 'object',
  properties: {
    question: { type: 'string' },
  },
  required: ['question'],
} as const;

@Injectable()
export class ProbeService {
  private readonly logger = new Logger('Probe');

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(RetrievalService) private readonly retrieval: RetrievalService,
    @Inject(LLM_PORT) private readonly llm: LlmPort,
  ) {}

  /* ---------------------------------------------------------------- *
   * 读库
   * ---------------------------------------------------------------- */

  private async loadSession(probeId: string): Promise<{
    id: string;
    microKpId: string;
    tier: LearnerTier;
    state: LadderState;
    askedQuestions: string[];
    turns: number;
    exited: boolean;
  }> {
    const rows = await this.db.query<{
      id: string;
      micro_kp_id: string;
      tier: LearnerTier;
      state: LadderState;
      asked_questions: string[];
      turns: number;
      exited: boolean;
    }>(
      `SELECT id, micro_kp_id, tier, state, asked_questions, turns, exited
         FROM probe_sessions WHERE id = $1`,
      [probeId],
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `追问会话不存在: ${probeId}` });
    }
    return {
      id: row.id,
      microKpId: row.micro_kp_id,
      tier: row.tier,
      state: row.state,
      askedQuestions: row.asked_questions,
      turns: row.turns,
      exited: row.exited,
    };
  }

  /** 快照：把 engine 的内部状态压成契约里的形状（不外泄 exits/lastAction）。 */
  private snapshot(state: LadderState): ProbeLadderSnapshot {
    return {
      level: state.level,
      cap: ladderCap({ tier: state.tier }),
      maxLevelUsed: state.maxLevelUsed,
      consecutiveUnknown: state.consecutiveUnknown,
      consecutiveWrong: state.consecutiveWrong,
      noProgress: state.noProgress,
      exited: state.exited,
    };
  }

  /**
   * 期望答案（给 judge 用，**永远不进提示词**）。
   *
   * 从当前知识点关联的关卡题目里取。取不到就返回 null —— judge 在
   * 「没有期望值」时仍能判「直接给结论」「多个问号」这两类越界。
   */
  private async expectedAnswer(
    microKpId: string,
  ): Promise<{ value: number | null; formula: string | null }> {
    const rows = await this.db.query<{ answer: unknown }>(
      `SELECT li.answer
         FROM level_items li
         JOIN levels l ON l.id = li.level_id
        WHERE l.micro_kp_id = $1
        LIMIT 1`,
      [microKpId],
    );
    const answer = rows[0]?.answer;
    if (answer === null || typeof answer !== 'object') return { value: null, formula: null };

    const record = answer as Record<string, unknown>;
    const rawValue = record.value;
    const value =
      typeof rawValue === 'number'
        ? rawValue
        : typeof rawValue === 'string' && rawValue.trim().length > 0 && !Number.isNaN(Number(rawValue))
          ? Number(rawValue)
          : null;
    const formula = typeof record.formula === 'string' ? record.formula : null;
    return { value, formula };
  }

  /* ---------------------------------------------------------------- *
   * 模型参与的两处（都不改变策略）
   * ---------------------------------------------------------------- */

  /**
   * 判定学习者刚才那句算「对/部分对/错」。
   *
   * `dont_know` / `give_up` / `frustration` 用 engine 的关键词分类先短路——
   * 这三类不需要模型判断，而且误判代价高（把「我不会」判成「错」会让
   * `consecutiveWrong` 涨得比 `consecutiveUnknown` 快，两边阈值就失真了）。
   */
  private async gradeReply(
    replyText: string,
    microKpId: string,
    question: string,
  ): Promise<ProbeReplyKindName> {
    const intent = classifyReply(replyText);
    if (intent === 'dont_know') return 'dont_know';
    if (intent === 'give_up') return 'give_up';
    if (intent === 'frustration') return 'frustration';

    const kp = await this.retrieval.assertKnowledgePointExists(microKpId).catch(() => null);
    try {
      const result = await this.llm.complete({
        messages: [
          {
            role: 'system',
            content: [
              '你在判定一个学生的回答相对他上一轮被问到的问题是否成立。',
              '只输出 JSON：{"verdict":"correct|partial|wrong"}。',
              'correct = 抓住了关键那一步；partial = 方向对但缺一环；wrong = 明确错误。',
              '不要给解题过程，不要补充任何其它字段。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `知识点：${kp?.name ?? microKpId}`,
              `被问到的问题：${question}`,
              `学生的回答：${replyText}`,
            ].join('\n'),
          },
        ],
        schema: GRADE_SCHEMA,
        temperature: 0,
      });
      const parsed = result.parsed;
      if (parsed !== null && typeof parsed === 'object') {
        const verdict = (parsed as Record<string, unknown>).verdict;
        if (verdict === 'correct' || verdict === 'partial' || verdict === 'wrong') return verdict;
      }
      this.logger.warn(`评分输出不是合法 verdict，按 partial 处理：${result.text.slice(0, 80)}`);
      return 'partial';
    } catch (error) {
      // 评分失败不阻断追问：partial 是唯一不改变策略状态的落点。
      this.logger.warn(
        `评分模型不可用，本轮按 partial 处理：${error instanceof Error ? error.message : String(error)}`,
      );
      return 'partial';
    }
  }

  /**
   * 把策略动作措辞成一个问题。
   *
   * **提示词里没有正确答案。** 只有阶梯级、主题、以及策略核心给的骨架问句
   * （`LADDER_LEVELS[].ask` 本身是安全文本）。模型做的是转述，不是解题。
   */
  private async phraseQuestion(
    action: LadderAction,
    state: LadderState,
    cap: LadderLevel,
  ): Promise<string> {
    const scaffold = this.safeQuestion(action, state, cap);

    // reveal / exit / acknowledge 不需要措辞：这几句是状态陈述，模型插不上手。
    if (action.kind !== 'hint' && action.kind !== 'reteach') return scaffold;

    const level = action.kind === 'hint' ? action.level : (TIER_START[state.tier] as LadderLevel);
    const topic = LADDER_LEVELS[level - 1] ?? LADDER_LEVELS[0];

    try {
      const result = await this.llm.complete({
        messages: [
          {
            role: 'system',
            content: [
              '你是一个核电子学辅导老师。把给定的动作改写成一句更贴合具体知识点的问题。',
              '硬约束：',
              '1. 只输出 JSON：{"question":"..."}，question 必须是简体中文。',
              '2. 只问一个问题，全句只允许出现一个问号，且以问号结尾。',
              '3. 不得给出最终数值、不得给出公式、不得给出结论。你是在问，不是在答。',
              '4. 不要复述学生的回答，不要自问自答。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `本轮可用到的最高阶梯：第 ${cap} 级`,
              `本轮使用的阶梯：第 ${level} 级（${topic.topic}）`,
              `策略核心给的问题骨架：${scaffold}`,
              `当前进展：连续「不知道」${state.consecutiveUnknown} 次，连续答错 ${state.consecutiveWrong} 次`,
              action.kind === 'reteach'
                ? '本轮是降级重讲：请换一个更小粒度的问题，不要重复骨架里的原话。'
                : '请保持问题的难度与原骨架一致。',
            ].join('\n'),
          },
        ],
        schema: PHRASE_SCHEMA,
        temperature: 0.3,
      });
      const parsed = result.parsed;
      if (parsed === null || typeof parsed !== 'object') return scaffold;
      const question = (parsed as Record<string, unknown>).question;
      if (typeof question !== 'string' || question.trim().length === 0) return scaffold;
      return question.trim();
    } catch (error) {
      this.logger.warn(
        `措辞模型不可用，退回骨架问句：${error instanceof Error ? error.message : String(error)}`,
      );
      return scaffold;
    }
  }

  /** 策略核心自己生成的问句——**永远安全**，是措辞越界时的兜底。 */
  private safeQuestion(
    action: LadderAction,
    state: LadderState,
    cap: LadderLevel,
  ): string {
    switch (action.kind) {
      case 'hint': {
        const topic = LADDER_LEVELS[action.level - 1] ?? LADDER_LEVELS[0];
        return `提示 ${action.level}/${cap}（${topic.topic}）：${topic.ask}`;
      }
      case 'reteach': {
        const start = TIER_START[state.tier] as LadderLevel;
        const topic = LADDER_LEVELS[start - 1] ?? LADDER_LEVELS[0];
        return `我们退回到更小的一步。${topic.ask}`;
      }
      case 'reveal':
        return action.message;
      case 'exit':
        return action.message;
      case 'acknowledge':
        return action.message;
      default:
        return '这一步你怎么看？';
    }
  }

  /* ---------------------------------------------------------------- *
   * 对外接口
   * ---------------------------------------------------------------- */

  async start(params: { microKpId: string; tier: LearnerTier }): Promise<ProbeSessionResponse> {
    const kp = await this.retrieval.assertKnowledgePointExists(params.microKpId).catch(() => {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `知识点不存在: ${params.microKpId}`,
      });
    });

    const probeId = `pr-${randomUUID()}`;
    const state = initialLadderState(params.tier);

    await this.db.query(
      `INSERT INTO probe_sessions (id, micro_kp_id, tier, state, asked_questions, turns, exited)
       VALUES ($1, $2, $3, $4::jsonb, '{}', 0, false)`,
      [probeId, kp.id, params.tier, JSON.stringify(state)],
    );

    return ProbeSessionResponseSchema.parse({
      probeId,
      microKpId: kp.id,
      tier: params.tier,
      ladder: this.snapshot(state),
      turns: 0,
      askedQuestions: [],
    });
  }

  async get(probeId: string): Promise<ProbeSessionResponse> {
    const session = await this.loadSession(probeId);
    return ProbeSessionResponseSchema.parse({
      probeId: session.id,
      microKpId: session.microKpId,
      tier: session.tier,
      ladder: this.snapshot(session.state),
      turns: session.turns,
      askedQuestions: session.askedQuestions,
    });
  }

  async reply(probeId: string, replyText: string): Promise<ProbeTurnResponse> {
    const session = await this.loadSession(probeId);

    const previousQuestion = session.askedQuestions[session.askedQuestions.length - 1] ?? '';
    const replyKind = await this.gradeReply(replyText, session.microKpId, previousQuestion);

    const transition = nextLadder(session.state, { kind: replyKind }, { tier: session.tier });
    const cap = transition.cap;

    const rawQuestion = await this.phraseQuestion(transition.action, transition.state, cap);
    const expected = await this.expectedAnswer(session.microKpId);

    // 越界判定：独立 judge，纯函数，不调模型。
    const isProbe = transition.action.kind !== 'reveal' && transition.action.kind !== 'exit';
    const firstJudge = judgeProbeReply({
      text: rawQuestion,
      isProbe,
      expectedValue: expected.value,
      expectedFormula: expected.formula,
    });

    const finalQuestion = firstJudge.passed
      ? rawQuestion
      : this.safeQuestion(transition.action, transition.state, cap);
    const finalJudge = firstJudge.passed
      ? firstJudge
      : judgeProbeReply({
          text: finalQuestion,
          isProbe,
          expectedValue: expected.value,
          expectedFormula: expected.formula,
        });

    if (!firstJudge.passed) {
      this.logger.warn(
        `追问措辞越界（${firstJudge.reasons.join(',')}），已退回骨架问句：${rawQuestion.slice(0, 60)}`,
      );
    }

    const ordinal = session.turns + 1;
    const nextState: LadderState = {
      ...transition.state,
      askedQuestions: await this.recordQuestion(session.askedQuestions, finalQuestion),
    };

    const actionReason = 'reason' in transition.action ? transition.action.reason : null;

    await this.db.query(
      `UPDATE probe_sessions
          SET state = $2::jsonb, asked_questions = $3, turns = $4, exited = $5, updated_at = now()
        WHERE id = $1`,
      [
        probeId,
        JSON.stringify(nextState),
        nextState.askedQuestions,
        ordinal,
        nextState.exited,
      ],
    );

    await this.db.query(
      `INSERT INTO probe_turns
         (probe_id, ordinal, reply_text, reply_kind, action, action_reason, question,
          judge, judge_passed, reject_reasons)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
      [
        probeId,
        ordinal,
        replyText,
        replyKind,
        transition.action.kind,
        actionReason,
        finalQuestion,
        JSON.stringify(finalJudge satisfies ProbeJudgeVerdict),
        finalJudge.passed,
        finalJudge.reasons,
      ],
    );

    return ProbeTurnResponseSchema.parse({
      probeId,
      microKpId: session.microKpId,
      tier: session.tier,
      replyKind,
      action: transition.action.kind,
      actionReason,
      question: finalQuestion,
      ladder: this.snapshot(nextState),
      judge: finalJudge,
      createdAt: await this.db.now(),
    });
  }

  /**
   * 记录问过的问题。
   *
   * 上限 20 条：这只是「别重复问同一个问题」的去重窗口，不是完整历史
   * （完整历史在 `app.probe_turns`）。无限增长会让 jsonb 与参数越来越大。
   */
  private async recordQuestion(existing: string[], question: string): Promise<string[]> {
    const next = existing.includes(question) ? [...existing] : [...existing, question];
    return next.slice(-20);
  }

  /**
   * 越界统计（票 10 的「泄露占比可测量」）。
   *
   * `reasonCounts` 按拒绝原因分别计数，因为「给了公式」和「问了两个问题」
   * 是两种缺陷，一个总率看不出该改哪里。
   */
  async metrics(): Promise<ProbeMetricsResponse> {
    const totals = await this.db.query<{ turns: string; violations: string }>(
      `SELECT count(*)::text AS turns,
              count(*) FILTER (WHERE NOT judge_passed)::text AS violations
         FROM probe_turns`,
    );
    const reasonRows = await this.db.query<{ reason: string; count: string }>(
      `SELECT reason, count(*)::text AS count
         FROM probe_turns, unnest(reject_reasons) AS reason
        GROUP BY reason ORDER BY reason`,
    );

    const turns = Number(totals[0]?.turns ?? '0');
    const violations = Number(totals[0]?.violations ?? '0');
    const reasonCounts: Record<string, number> = {};
    for (const row of reasonRows) reasonCounts[row.reason] = Number(row.count);

    return ProbeMetricsResponseSchema.parse({
      turns,
      violations,
      violationRate: turns === 0 ? 0 : violations / turns,
      reasonCounts,
    });
  }
}

/** 档位 → 起始阶梯。reteach 时退回到这里。 */
const TIER_START: Record<LearnerTier, number> = { P1: 1, P2: 2, P3: 3 };
