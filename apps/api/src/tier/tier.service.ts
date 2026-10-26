/**
 * 三档渲染参数的服务层（票 12）。
 *
 * ## 这一层只做三件事
 *
 * ① 把「当前生效档位」问出来 —— **不是**自己读 `placement_profile`，而是调
 *    `PlacementService.status()`。那里面有票 11 的惰性自动结算：门槛一到就在
 *    读的时候完成重判并落库。档位有两个读取入口（`/placement` 与 `/tier`），
 *    如果这里自己 `SELECT tier`，会出现「打开首页看到已升档、打开关卡页还是旧档」
 *    这种一刷新就变的事实 —— 同一份状态两个读法必然漂移。
 * ② 把 engine 的 `TIER_PARAMS` 投影成契约形状。**参数值一个都不在这里写**：
 *    这一层只负责搬运，改数字请改 `packages/engine/src/tier.ts`。
 * ③ 把档位的「为什么」翻成人话（`explanation`），读的是学习日志里那些
 *    `tier_rejudge` 事件 —— 票 12 验收 3 要求学习者能看到「为什么给我降档了」。
 *
 * ## 为什么没有写接口
 *
 * 档位不是可以直接改的设置项：它是定级结果与学习证据的**结论**。唯一能让
 * 它变的路径是重判（`POST /placement/rejudge` 或读状态时的自动结算）。
 * 给 `/tier` 配一个 PATCH 就等于留了一个「绕过证据改档位」的后门。
 */
import { Inject, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import {
  TierLevelPlanResponseSchema,
  TierOverviewResponseSchema,
  TierSessionPlanResponseSchema,
  type TierChangesResponse,
  type TierLevelPlanResponse,
  type TierMasteryProgress,
  type TierOverviewResponse,
  type TierSessionPlanResponse,
} from '@starmap/api-contract';
import { validateLevelSpec, type LevelSpec } from '@starmap/shared';
import {
  FIRST_ROUND_DESCRIPTION,
  TIER_LABEL,
  masteryRuleProgress,
  planFirstRound,
  tierParams,
  type ProficiencyTier,
} from '@starmap/engine';
import { DatabaseService } from '../db/database.service.js';
import { PlacementService, TIER_REJUDGE_EVENT } from '../placement/placement.service.js';
import { RecommendService } from '../recommend/recommend.service.js';

/** 学习日志里表示「档位被重判改变」的事件名。写入方是 `PlacementService`。 */
export { TIER_REJUDGE_EVENT };

type LevelRow = {
  id: string;
  micro_kp_id: string;
  spec: unknown;
};

type TierLogRow = {
  id: string;
  event: string;
  payload: unknown;
  created_at: Date | string;
};

/** `app.attempts` 里掌握判定需要的那两列。 */
type AttemptRow = {
  correct: boolean;
  knowledge_kind: string | null;
};

@Injectable()
export class TierService {
  private readonly placement: PlacementService;
  private readonly recommend: RecommendService;

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {
    this.placement = new PlacementService(db);
    this.recommend = new RecommendService(db);
  }

  /**
   * 当前生效档位。
   *
   * 走 `PlacementService.status()`：它会顺手完成迟到的重判结算，所以这个
   * 函数返回的档位与 `/api/v1/placement` 返回的永远是同一个值。
   *
   * `attemptsSince` 顺路带回来（票 06 的判定依据窗）：status() 本来就算
   * 了它，再算一遍会出现「依据句里的数字与重判看到的证据不是同一批」。
   */
  private async currentTier(): Promise<{
    tier: ProficiencyTier;
    source: 'placement' | 'fallback';
    attemptsSince: number;
  }> {
    const status = await this.placement.status();
    if (status.tier === null) {
      // 没定过级：参数回落到 P1，但用 `source` 说清「这是默认值，不是结论」。
      return { tier: 'P1', source: 'fallback', attemptsSince: status.attemptsSince };
    }
    return {
      tier: status.tier as ProficiencyTier,
      source: 'placement',
      attemptsSince: status.attemptsSince,
    };
  }

  /** 当前档位与六维参数。 */
  async overview(): Promise<TierOverviewResponse> {
    const { tier, source, attemptsSince } = await this.currentTier();
    const params = tierParams(tier);
    return TierOverviewResponseSchema.parse({
      tier,
      source,
      params,
      label: TIER_LABEL[tier],
      description: FIRST_ROUND_DESCRIPTION[params.firstRoundShape],
      ...(await this.basisOf(tier, source, attemptsSince)),
    });
  }

  /**
   * 判定依据句与三个数值（票 06）。
   *
   * ## 三个数字描述同一个证据窗
   *
   * 窗口 = 自上次定级/重评以来的作答（`counts_toward_mastery = true`，取最近
   * `attemptsSince` 条）。选这个窗而不是全历史，是因为它恰好是**下一次重判
   * 将要看的证据**——依据句说的是「档位靠什么撑着」，全历史会把已经结算过
   * 的旧证据再算一遍，与 `/tier/changes` 里 `attemptsSince` 的口径漂移。
   *
   * ## 连对的分母
   *
   * 句子里的「连对 x/y」分母取本档 `masteryRule.consecutiveCorrect`（P1/P2=2、
   * P3=1），与 `TierMasteryProgress` 用同一条规则——两处分母不同的话，学习者
   * 会在档位卡与门槛卡看到两个互相矛盾的「还差几次」。
   *
   * ## fallback 不拼数字
   *
   * 没定级记录就没有基线可减，任何数字都是编的，所以给引导句 + 三个 0
   * （0 是「没有证据」的诚实值，与 percent=null 的「不知道」语义不同：这里
   * 字段是 int 不是 nullable，fallback 本身就是「还没有判定」这个结论）。
   */
  private async basisOf(
    tier: ProficiencyTier,
    source: 'placement' | 'fallback',
    attemptsSince: number,
  ): Promise<Pick<TierOverviewResponse, 'basis' | 'basisAttempts' | 'basisVariants' | 'basisStreak'>> {
    if (source === 'fallback') {
      return {
        basis: '定级后这里会写判定依据',
        basisAttempts: 0,
        basisVariants: 0,
        basisStreak: 0,
      };
    }

    // 倒序取窗：连对要从最新一条往前数，倒序数组上一个 while 就是它。
    // `counts_toward_mastery = false` 的行必须排除，与 masteryProgress 的
    // 过滤条件同一个理由（深究段诚实暴露不会不是反向证据）。
    const rows = await this.db.query<{ correct: boolean; variant_group: string }>(
      `SELECT correct, variant_group
         FROM attempts
        WHERE counts_toward_mastery = true
        ORDER BY created_at DESC, id DESC
        LIMIT $1`,
      [attemptsSince],
    );

    const variants = new Set(rows.map((row) => row.variant_group)).size;
    let streak = 0;
    for (const row of rows) {
      if (!row.correct) break;
      streak += 1;
    }
    const required = tierParams(tier).masteryRule.consecutiveCorrect;

    return {
      basis: `由 ${attemptsSince} 次作答判定 · ${variants} 个变式已覆盖 · 连对 ${streak}/${required}`,
      basisAttempts: attemptsSince,
      basisVariants: variants,
      basisStreak: streak,
    };
  }

  /**
   * 某一关在这一档下的首轮计划。
   *
   * 必须由服务端算：`direct` 要往 spec 里找「第一段带题的段」，`completion`
   * 要取「第一段带卡的段的最后一张卡」的 id。前端自己推导就要把这套规则
   * 再写一遍，而两份规则漂移的后果是「同一个学习者在两处看到不同的首屏」。
   */
  async levelPlan(levelId: string): Promise<TierLevelPlanResponse> {
    const rows = await this.db.query<LevelRow>(
      `SELECT id, micro_kp_id, spec FROM levels WHERE id = $1`,
      [levelId],
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `关卡不存在: ${levelId}` });
    }

    // 坏 spec 是服务端数据问题（500），不是调用方传错参数（400）。这里不重复
    // `LevelsController` 的 409 入口锁检查：那是「能不能进这一关」，与
    // 「进来之后按哪一档渲染」是两件事，混在一起会让 404/409/500 的语义乱掉。
    const validated = validateLevelSpec(row.spec);
    if (!validated.ok) {
      throw new InternalServerErrorException({
        code: 'INTERNAL',
        message: `关卡规范不合法: ${levelId}`,
        details: validated.issues,
      });
    }
    const spec: LevelSpec = validated.spec;
    const { tier, source } = await this.currentTier();
    const params = tierParams(tier);

    return TierLevelPlanResponseSchema.parse({
      levelId: row.id,
      microKpId: row.micro_kp_id,
      tier,
      source,
      params,
      firstRound: planFirstRound(spec.steps, tier),
      masteryProgress: await this.masteryProgress(row.micro_kp_id, tier),
    });
  }

  /**
   * 按本档判定规则算这个知识点还差什么。
   *
   * 证据取自 `app.attempts` 的**回放**（`counts_toward_mastery = true`，按
   * `created_at, id` 升序），不读 `app.mastery` 快照：
   * - 快照里没有「连续答对几次」与「做过迁移题没有」这两个量，判定规则恰好
   *   就靠这两个；现算就得把回放再做一遍，那不如直接回放。
   * - 快照的 `current` 随时间衰减，而「连续答对 2 次」不应该因为隔了三天没来
   *   就变回「还差 2 次」——判定规则是行为序列的属性，不是概率。
   *
   * `counts_toward_mastery = false` 的行（深究/再讲解段的作答）必须排除，与
   * `mastery/repository.ts` 的 `loadEvidence` 用同一个过滤条件：两处不一致会让
   * 「在深究段诚实暴露不会」变成反向证据。
   */
  private async masteryProgress(
    microKpId: string,
    tier: ProficiencyTier,
  ): Promise<TierMasteryProgress> {
    const rows = await this.db.query<AttemptRow>(
      `SELECT correct, knowledge_kind
         FROM attempts
        WHERE micro_kp_id = $1
          AND counts_toward_mastery = true
        ORDER BY created_at ASC, id ASC`,
      [microKpId],
    );
    return masteryRuleProgress(
      rows.map((row) => ({
        correct: row.correct,
        knowledgeKind: asKnowledgeKind(row.knowledge_kind),
      })),
      tierParams(tier).masteryRule,
    );
  }

  /**
   * 档位变更历史。
   *
   * 数据源是 `learning_log` 里 `event = 'tier_rejudge'` 的那些行，**不是**
   * `placement_rejudges` 表：前者是「学习者能看懂的事件流」，后者是定级模块
   * 的内部审计表（字段按定级的需要长，且重新定级后旧记录会被指针作废）。
   * 票 12 要展示的是「我这一路被调过几次档、每次为什么」，那属于学习日志。
   *
   * ## 为什么先调一次 `status()` 再读日志
   *
   * 票 11 的重判是**读时惰性结算**：门槛一到，下一次 `GET /placement` 或
   * `GET /tier` 就当场把重判做完并落库。`/tier/changes` 若直接读日志，就会
   * 出现这一帧：档位页（`/tier`）说「你已从 P2 降到 P1」，变更历史里一条都
   * 没有 —— 因为那条事件要到**下一次**读档位才被写进去。学习者刚被降档时
   * 恰好最想看理由，而这个顺序把理由藏了一轮。
   *
   * 代价是每次读历史多一次 `status()`（它自己只读档案 + 一次 count）；相对
   * 「理由晚一轮出现」这个缺陷，这个代价可以接受。
   */
  async changes(limit = 10): Promise<TierChangesResponse> {
    // 不读返回值，只为触发惰性结算的副作用。写成语句而不是 `void ...`，
    // 是因为有人看到 `void this.placement.status()` 会以为它是可省的。
    // 不读返回值，只为触发惰性结算的副作用。写成语句而不是 `void ...`，
    // 是因为有人看到 `void this.placement.status()` 会以为它是可省的。
    await this.placement.status();

    const rows = await this.db.query<TierLogRow>(
      `SELECT id, event, payload, created_at
         FROM learning_log
        WHERE event = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      [TIER_REJUDGE_EVENT, limit],
    );

    return {
      items: rows.map((row) => {
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        return {
          id: String(row.id),
          at: toIsoString(row.created_at),
          previousTier: asTier(payload.previousTier, 'P1'),
          tier: asTier(payload.tier, 'P1'),
          changed: payload.changed === true,
          attemptsSince: Number(payload.attemptsSince ?? 0),
          averageFirstTryRate:
            typeof payload.averageFirstTryRate === 'number' ? payload.averageFirstTryRate : null,
          explanation: typeof payload.explanation === 'string' ? payload.explanation : '',
        };
      }),
    };
  }

  /**
   * 本次会话的下一步（受档位的「单次会话新知识点上限」约束）。
   *
   * 推荐列表回答「学什么最好」（票 13），这个回答「这一档一次最多开几个」。
   * 两者的排序必须一致 —— 所以这里直接调 `RecommendService.list()` 而不是
   * 自己写一条推荐查询。`deferred` 独立于 `items.length` 存在：0 表示
   * 「没有更多推荐了」，>0 表示「还有 N 个下次再开」，两种话说给学习者听
   * 完全不同。
   */
  async sessionPlan(): Promise<TierSessionPlanResponse> {
    const { tier, source } = await this.currentTier();
    const params = tierParams(tier);
    const list = await this.recommend.list();
    const limited = list.recommendations.slice(0, params.sessionNewKpLimit);
    const ids = limited.map((item) => item.microKpId);

    const levelRows =
      ids.length === 0
        ? []
        : await this.db.query<{ micro_kp_id: string }>(
            `SELECT DISTINCT micro_kp_id FROM levels WHERE micro_kp_id = ANY($1::text[])`,
            [ids],
          );
    const withLevel = new Set(levelRows.map((row) => row.micro_kp_id));

    return TierSessionPlanResponseSchema.parse({
      tier,
      source,
      limit: params.sessionNewKpLimit,
      items: limited.map((item) => ({
        microKpId: item.microKpId,
        name: item.name,
        hasLevel: withLevel.has(item.microKpId),
      })),
      deferred: Math.max(0, list.recommendations.length - limited.length),
    });
  }
}

/**
 * `timestamptz` 会被驱动解成 `Date`。契约声明的是 `z.string()`，而
 * `Date.prototype.toString()` 给出的是 `Wed Oct 21 2026 ...` 这种本地化格式
 * —— 它能过 `z.string()` 检查，到前端 `new Date(...)` 才乱。统一走 toISOString。
 */
function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function asTier(value: unknown, fallback: ProficiencyTier): ProficiencyTier {
  return value === 'P1' || value === 'P2' || value === 'P3' ? value : fallback;
}

/**
 * `attempts.knowledge_kind` 是 `text`（列上有 CHECK 约束，但历史行为 null）。
 * 与 `mastery/evidence.ts` 的 `kindOf` 保持同一套回落：无法识别的值按 `concept`
 * 算，不当作「没做过迁移题」之外的第三种状态 —— 多一个分支就多一处可漂移的地方。
 */
function asKnowledgeKind(value: string | null): 'fact' | 'concept' | 'comprehensive' {
  return value === 'fact' || value === 'comprehensive' ? value : 'concept';
}
