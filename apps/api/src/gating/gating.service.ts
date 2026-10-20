import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  GateEvaluationSchema,
  GateHistoryResponseSchema,
  GateResponseSchema,
  UnlockStateSchema,
  type GateEvaluation,
  type GateHistoryResponse,
  type GateRemediation,
  type GateResponse,
  type UnlockState,
} from '@starmap/api-contract';
import {
  GATE_RULES,
  appliedThreshold,
  evaluateExitGate,
  type GateRule,
  type GateResult,
} from '@starmap/engine';
import { validateLevelSpec, type LevelGating, type LevelItem, type LevelSpec } from '@starmap/shared';
import { DatabaseService } from '../db/database.service.js';
import type { Runner } from '../mastery/repository.js';
import {
  attemptsForGate,
  downstreamNodeIds,
  findLevel,
  gateLogs,
  gatedPrerequisites,
  knowledgePointExists,
  knowledgePointName,
  recordUnlock,
  unlockedBy,
  writeGateLog,
  type GateLevelRow,
} from './repository.js';

/**
 * 出口门控与解锁（票 06）。
 *
 * ## 三件必须一起发生的事
 *
 * 一次判定会同时改两个地方：往 `learning_log` 追加一条事件（事件流：每次都
 * 留，包括没过的），以及在通过时往 `node_unlocks` 插解锁行（状态：是非题）。
 * 它们和判定本身放在**同一个事务**里 —— 「过了但没解锁」会让学习者反复重考，
 * 「解锁了但日志没记」会让回看断链。
 *
 * ## 判定数值不由内容作者决定
 *
 * 关卡 spec 里的 `gating.itemCount` / `gating.passCount` 是作者对「这张卷
 * 打算考几道、几分算过」的声明，校验器只用它保证卷子够长；**真正的达标线
 * 来自 spec 文档表 3（章末出口 8/7、高入度先修 10/9）**。若改成读 spec 的
 * 数值，作者只要把 `passCount` 写成 1 就能让门控形同虚设 —— 而门控的全部
 * 意义就是「内容作者不能替学习者决定他没有掌握」。
 *
 * ## 为什么门控不塞进提交作答
 *
 * spec 需求 17：「关内允许尝试—失败—再听讲解，失败计入进度」。作答是关内的
 * 连续行为，每次答错都触发一次判定会让学习者每答错一题就看到一次不及格。
 * 门控是在**出口上主动发起的一次考试**，节律不同，接口也分开。
 */
@Injectable()
export class GatingService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** 池上的执行器：纯读路径不开事务。 */
  private get runner(): Runner {
    return (sql, params) => this.db.query(sql, params ?? []);
  }

  /**
   * 评一次门控。
   *
   * 不幂等，但也不会重复计分：每次都重读 `attempts` 里已有的作答，重复调用
   * 只会再写一条同样结论的日志；解锁行 `ON CONFLICT DO NOTHING`，不会把
   * 首次解锁时间改写。
   */
  async evaluate(levelId: string): Promise<GateResponse> {
    const client = await this.db.connection.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `gate:${levelId}`,
      ]);
      const run: Runner = async (sql, params) => {
        const result = await client.query(sql, params as unknown[]);
        return result.rows as Record<string, unknown>[];
      };

      const level = await findLevel(run, levelId);
      if (!level) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: `关卡不存在: ${levelId}` });
      }
      const spec = this.specOf(level);

      // 入口锁：先修门还没开就不该来考这张卷。放在事务里读，避免「查完刚好
      // 被另一条并发判定解锁」的错觉。
      const lock = await this.unlockStateWith(run, level.micro_kp_id);
      if (!lock.unlocked) throw this.lockedException(lock);

      const rule = ruleFor(spec.gating);
      const itemIds = gateItemIds(spec);
      const attempts = await attemptsForGate(run, level.micro_kp_id, levelId, itemIds);
      const correct = attempts.filter((attempt) => attempt.correct).length;
      const result = evaluateExitGate(correct, attempts.length, rule);

      const nowRows = (await run(`SELECT now()::text AS now`)) as { now: string }[];
      const evaluatedAt = nowRows[0]?.now ?? new Date().toISOString();

      const attemptedItemIds = attempts.map((attempt) => attempt.item_id);
      const wrongItemIds = attempts.filter((a) => !a.correct).map((a) => a.item_id);
      const evaluation: GateEvaluation = GateEvaluationSchema.parse({
        levelId: level.id,
        microKpId: level.micro_kp_id,
        mode: spec.gating.mode,
        verdict: result.verdict,
        reason: result.reason,
        passed: result.passed,
        rule: appliedThreshold(rule, attempts.length),
        correct: Math.min(correct, attempts.length),
        total: attempts.length,
        shortfall: Math.max(0, result.shortfall),
        message: result.message,
        itemIds: attemptedItemIds,
        wrongItemIds,
        evaluatedAt,
        remediation: result.passed ? null : this.remediation(spec, result, rule, wrongItemIds),
      });

      // 只有真的设了门控的关卡才写日志：`mode:'none'` 的判定结论是「此处不设
      // 门控」，那不是一次门控结果，每个学习者翻开小结都记一条会把日志淹掉。
      if (spec.gating.mode !== 'none') {
        await writeGateLog(run, {
          microKpId: level.micro_kp_id,
          event: `gate_${result.verdict}`,
          payload: evaluation,
        });
      }

      const unlockedNodeIds: string[] = [];
      if (result.passed && spec.gating.mode !== 'none') {
        const gateMode = spec.gating.mode;
        const downstream = await downstreamNodeIds(run, level.micro_kp_id);
        for (const nodeId of downstream) {
          const inserted = await recordUnlock(run, {
            nodeId,
            prerequisiteId: level.micro_kp_id,
            levelId: level.id,
            gateMode,
            correct: evaluation.correct,
            itemCount: evaluation.total,
          });
          // 只报「本次新解锁的」：把历史解锁也列出来会让学习者以为刚又开了新东西。
          if (inserted) unlockedNodeIds.push(nodeId);
        }
      }

      await client.query('COMMIT');
      return GateResponseSchema.parse({ evaluation, unlockedNodeIds });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** 一个知识点当前的解锁状态。 */
  /**
   * 「进这个知识点的关卡之前，先确认它已经解锁」。
   *
   * 与 {@link evaluate} 内部的入口检查共用同一份判定（{@link unlockStateWith}），
   * 区别只在于这里走池连接、不开事务：读关卡是纯读，没有要保护的不变量。
   *
   * 抛 409 而不是 403，理由见 {@link lockedException}。之所以要有一个独立方法，
   * 是因为「进关卡」与「评门控」是两个入口：前者由 GET /levels/{id} 调，后者由
   * POST /levels/{id}/gate 调。让两处读同一个函数，才不会出现「列表说锁着、
   * 点进去却能做」这种自相矛盾的状态。
   */
  async requireUnlocked(microKpId: string): Promise<UnlockState> {
    const state = await this.unlockState(microKpId);
    if (!state.unlocked) throw this.lockedException(state);
    return state;
  }

  async unlockState(microKpId: string): Promise<UnlockState> {
    if (!(await knowledgePointExists(this.runner, microKpId))) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `知识点不存在: ${microKpId}` });
    }
    return this.unlockStateWith(this.runner, microKpId);
  }

  /** 一张关卡的门控判定历史（新的在前）。 */
  async history(levelId: string): Promise<GateHistoryResponse> {
    const level = await findLevel(this.runner, levelId);
    if (!level) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `关卡不存在: ${levelId}` });
    }
    const rows = await gateLogs(this.runner, {
      microKpId: level.micro_kp_id,
      levelId,
      limit: 20,
    });
    const evaluations: GateEvaluation[] = [];
    for (const row of rows) {
      const parsed = GateEvaluationSchema.safeParse(row.payload);
      // 历史行可能来自旧版本形状：读不懂就跳过，不让一条坏日志把整页打挂。
      if (parsed.success) evaluations.push(parsed.data);
    }
    return GateHistoryResponseSchema.parse({ levelId, evaluations });
  }

  /**
   * 未解锁时该抛的 409。
   *
   * ## 为什么是 409 而不是 403
   *
   * 403 的语义是「你没有权限」，判断依据应当是身份；本应用没有登录态，
   * 也不存在「这个学习者不许看」的知识。
   * 409 Conflict 的语义是「请求与资源当前状态冲突」—— 这里正是如此：内容
   * 存在，但**它前面的门还没开**，换个状态（先过先修门）再请求就行。
   * 另一个现实理由：统一异常过滤器把 403 归到 `INTERNAL`，前端拿不到可分支
   * 的错误码，会把「还没解锁」显示成「服务器坏了」。
   */
  private lockedException(state: UnlockState): ConflictException {
    return new ConflictException({
      code: 'CONFLICT',
      message: `这个关卡还没解锁：${state.blockers.map(blockerText).join('；')}`,
      details: state,
    });
  }

  /**
   * 一个节点被哪些门挡着、各差多少。
   *
   * 只认**设了门控**的先修边：spec 需求 17 说硬门槛只设在章末出口与高入度先修
   * 节点，其余先修关系是软提示（推荐排序用），挡住会让学习者寸步难行。
   */
  private async unlockStateWith(run: Runner, microKpId: string): Promise<UnlockState> {
    const rows = await gatedPrerequisites(run, microKpId);
    const blockers: UnlockState['blockers'] = [];

    for (const row of rows) {
      const spec = trySpec(row.spec);
      const mode = spec?.gating.mode ?? 'none';
      // 先修节点没有关卡、或它的关卡不设门控、或它的 spec 坏了 —— 都不该拿
      // 一份读不懂的数据去拦人。
      if (mode === 'none' || row.level_id === null) continue;
      if (await unlockedBy(run, microKpId, row.prerequisite_id)) continue;

      const [latest] = await gateLogs(run, {
        microKpId: row.prerequisite_id,
        levelId: row.level_id,
        limit: 1,
      });
      const last = latest ? GateEvaluationSchema.safeParse(latest.payload) : undefined;
      const evaluation = last?.success ? last.data : undefined;
      blockers.push({
        prerequisiteId: row.prerequisite_id,
        prerequisiteName: row.prerequisite_name,
        levelId: row.level_id,
        levelTitle: row.level_title,
        gateMode: mode,
        lastVerdict: evaluation?.verdict ?? null,
        shortfall: evaluation ? Math.max(0, evaluation.shortfall) : null,
        lastAttemptedItemIds: evaluation?.itemIds ?? [],
      });
    }

    return UnlockStateSchema.parse({
      microKpId,
      unlocked: blockers.length === 0,
      blockers,
    });
  }

  /**
   * 重讲路径 —— 「没通过」不能只回一句不合格。
   *
   * 指向本关真实存在的 reteach 段（有 id 与标题，前端可以直接给一个跳回去
   * 的按钮），并把答错的那几道题的题干念出来：学习者需要知道缺的是哪一块，
   * 而不是一个分数。
   */
  private remediation(
    spec: LevelSpec,
    result: GateResult,
    rule: GateRule,
    wrongItemIds: readonly string[],
  ): GateRemediation {
    const reteach = spec.steps.find((step) => step.kind === 'reteach');
    const stems = wrongItemIds
      .map((itemId) => spec.items.find((item) => item.id === itemId))
      .filter((item): item is LevelItem => Boolean(item))
      .map((item) => truncate(item.stem, 24));

    // 这里必须读 `rule` 而不是常量：先修门是 10 道、出口门是 8 道，
    // 写死 `GATE_RULES.exit.itemCount` 会让先修门的学习者被告知「要 8 道」，
    // 做满 8 道之后判定仍是 undetermined —— 一句错误的话术能让人白做一遍。
    const head =
      result.reason === 'insufficient_items'
        ? `这道${rule.mode === 'prereq' ? '先修' : '出口'}测试要 ${rule.itemCount} 道判定题才算数，现在还差 ${Math.max(0, result.shortfall)} 道没做。`
        : `还差 ${Math.max(0, result.shortfall)} 道判定题达标（${result.message}）`;

    const detail = stems.length > 0 ? `答错的是：${stems.join('、')}。` : '';
    const next = reteach
      ? `先回到「${reteach.title}」把这一块重听一遍，再回来重做这几道题。`
      : `先回到「${spec.meta.title}」的讲解卡片把这一块重看一遍，再回来重做这几道题。`;

    return {
      kind: reteach ? 'reteach' : 'practice',
      stepId: reteach?.id ?? null,
      stepTitle: reteach?.title ?? null,
      microKpId: reteach ? null : spec.meta.microKpId,
      message: `${head}${detail}${next}`,
    };
  }

  /** 读关卡 spec；坏 spec 是服务端问题（内容入库时没校验），不是学习者的错。 */
  private specOf(level: GateLevelRow): LevelSpec {
    const validated = validateLevelSpec(level.spec);
    if (!validated.ok) {
      throw new InternalServerErrorException({
        code: 'INTERNAL',
        message: `关卡规范不合法: ${level.id}`,
        details: validated.issues,
      });
    }
    return validated.spec;
  }
}

/**
 * 判定用的规则。
 *
 * `mode:'none'` 时把作者声明的数值透传下去，让引擎走它自己的「此处不设门控」
 * 分支；`exit`/`prereq` 一律用 spec 表 3 的固定数值（见类注释）。
 */
export function ruleFor(gating: LevelGating): GateRule {
  if (gating.mode === 'none') {
    return { mode: 'none', itemCount: gating.itemCount, passCount: gating.passCount };
  }
  return GATE_RULES[gating.mode];
}

/**
 * 门控考哪些题：**判定段**引用的题。
 *
 * 不拿全关的题：教学关卡里深究段那几道是为了暴露错误，答对答错都不该算进
 * 出口成绩（spec 需求 17）。判定段没有题时退回到 `pool:'core'` 的题，再退回
 * 全部 —— 早期内容里关卡结构可能还没细分，不至于因此完全判不了。
 */
export function gateItemIds(spec: LevelSpec): string[] {
  const quizItemIds = new Set<string>();
  for (const step of spec.steps) {
    if (step.kind !== 'quiz') continue;
    for (const itemId of step.itemIds) quizItemIds.add(itemId);
  }
  if (quizItemIds.size > 0) {
    // 按 spec.items 的顺序输出：判定结果里的题目顺序要稳定，前端列错题不会每次跳。
    return spec.items.filter((item) => quizItemIds.has(item.id)).map((item) => item.id);
  }
  const core = spec.items.filter((item) => item.pool === 'core').map((item) => item.id);
  return core.length > 0 ? core : spec.items.map((item) => item.id);
}

function trySpec(raw: unknown): LevelSpec | undefined {
  const validated = validateLevelSpec(raw);
  return validated.ok ? validated.spec : undefined;
}

function blockerText(blocker: UnlockState['blockers'][number]): string {
  const where = blocker.levelTitle ? `「${blocker.levelTitle}」` : '';
  const progress =
    blocker.shortfall === null
      ? '还没考过它的出口测试'
      : blocker.shortfall === 0
        ? '最近一次判定达标但还没记录解锁'
        : `还差 ${blocker.shortfall} 道题`;
  return `先通过「${blocker.prerequisiteName}」${where}的出口测试（${progress}）`;
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}
