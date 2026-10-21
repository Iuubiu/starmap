import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  MasteryState,
  Recommendation as RecommendationDto,
  RecommendationListResponse,
  RedirectRequest,
  RedirectResponse,
  TodaySummary,
} from '@starmap/api-contract';
import {
  recommend,
  type EvidenceEvent,
  type MasterySnapshot,
  type RecommendCandidate,
  type RecommendEdge,
} from '@starmap/engine';
import { DatabaseService } from '../db/database.service.js';
import { groupByMicroKp, snapshotOf } from '../mastery/evidence.js';
import { floorToGranularity } from '../mastery/mastery.service.js';
import { loadEvidence, type Runner } from '../mastery/repository.js';

/** 叶节点的静态位置信息（推荐的排序键与展示用）。 */
interface LeafRow extends Record<string, unknown> {
  id: string;
  name: string;
  depth: number;
  ordinal: number;
  module_id: string;
  module_name: string;
  module_ordinal: number;
  /**
   * 这个叶节点「有内容」吗（有 chunk 或有可用关卡）。
   *
   * 只过滤**推荐候选集**，不过滤图谱：图谱是导航结构，节点得有地方可点；
   * 推荐是「该学什么」，推一条点进去空白页的节点就是把人往墙角引。
   */
  has_content: boolean;
}

interface EdgeRow extends Record<string, unknown> {
  from_id: string;
  to_id: string;
}

interface ReviewRow extends Record<string, unknown> {
  micro_kp_id: string;
  next_review_at: Date;
}

interface RedirectRow extends Record<string, unknown> {
  recommended: string;
  created_at: Date;
}

interface AvailabilityRow extends Record<string, unknown> {
  available: boolean;
}

interface TodayCountRow extends Record<string, unknown> {
  answered: number;
  knowledge_points: number;
}

/**
 * 一个叶节点回放出来的全部事实。
 *
 * 图谱端点与推荐端点都从这里取数：`state` / `percent` 是**回放**结果，不是
 * `app.mastery` 的缓存列。两处读同一个对象，才谈得上「同一时刻指向同一批」。
 */
export interface LeafFacts {
  microKpId: string;
  name: string;
  depth: number;
  ordinal: number;
  moduleId: string;
  moduleName: string;
  moduleOrdinal: number;
  state: MasteryState;
  /**
   * 证据不足时是 **null**，不是 0。
   *
   * 用 0 顶替会让「从没学过」在界面上显示成「0%」——那是把「没有数据」说成
   * 「测出来是零」，与 spec 第 259 行「低于门槛显示证据不足」直接冲突。
   */
  percent: number | null;
  /** 原始回放快照（推荐算法要 attemptCount/variantCount/achieved 等）。 */
  snapshot: MasterySnapshot;
  reviewDueAt: string | null;
}

/**
 * 今日推荐 + 今日学习摘要。
 *
 * ## 数字从哪里来：attempts 回放，不读 `app.mastery` 的数值列
 *
 * 票 13 验收第 4 条要求「推荐理由里的数字必须来自真实掌握度」。`app.mastery`
 * 是**派生缓存**（captain 裁定：canonical = attempts 回放），它记的是「上次
 * 作答那一刻的 current」，而 `current` 会随半衰期持续变小。直接读它等于把
 * 「上次算的时候」当成「现在」——于是看板说「你只有 32%」，点进详情页（走
 * `MasteryService`，现算）却显示 35%，两处都对不上。
 *
 * 所以这里复用 `MasteryService` 用的同一套纯函数（`loadEvidence` +
 * `snapshotOf`）：一次把全部证据取回来，按知识点分组重放。读的是同一张表、
 * 同一个过滤条件（`counts_toward_mastery = true`）、同一串排序，因此和掌握度
 * 接口算出的数逐位相同。
 *
 * `app.mastery` 里只取**一列**：`next_review_at`。那不是掌握度数字，是票 07
 * 写下的复验排期，没有第二个来源。取不到就当作「没排期」，不自己发明规则。
 *
 * ## 为什么一次重放全部叶节点
 *
 * 逐个知识点调 `MasteryService.view()` 会是 2000+ 次往返。把证据一次取回、
 * 在内存里分组重放，是同一份计算换一种批量形态，不是第二套算法。
 *
 * ## 为什么图谱端点也调这里
 *
 * 票 13 验收第 5 条：「图谱与看板推荐同一时刻指向同一批节点」。唯一能保证的
 * 做法是两边调**同一个函数**（`recommend()`）并共享同一时刻。`GraphController`
 * 因此注入本服务，把 `recommendedIds()` 放进图谱响应；对照两处结果就能断言，
 * 而不是靠「希望两次请求之间数据没变」。
 */
@Injectable()
export class RecommendService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** 池上的执行器。读路径不开事务。 */
  private get runner(): Runner {
    return (sql, params) => this.db.query(sql, params ?? []);
  }

  /** 数据库侧的当前时刻（与掌握度接口同一个时间基准）。 */
  async now(): Promise<string> {
    return this.db.now();
  }

  /**
   * 图谱端点用：一张图要的全部东西 —— 每个叶节点的回放事实 + 推荐 id。
   *
   * 只算一次 `computeAll()`，两个投影从**同一份结果**里取。如果让图谱端点
   * 分别调「取事实」和「取推荐」，就是两次全量回放，而且两次之间只要有数据
   * 变更，图上的状态与推荐标记就可能不属于同一时刻 —— 票 13 验收第 5 条要的
   * 正是「同一时刻」。
   *
   * 推荐顺序有意义（就是优劣顺序）；空数组表示「此刻没有可推荐的节点」，
   * 不是「功能没接通」。
   */
  async graphData(
    evaluatedAt: string,
  ): Promise<{ facts: LeafFacts[]; recommendedIds: string[] }> {
    const { facts, recommendations } = await this.computeAll(evaluatedAt);
    return { facts, recommendedIds: recommendations.map((item) => item.microKpId) };
  }

  /** 看板用：推荐 + 今日摘要。 */
  async list(): Promise<RecommendationListResponse> {
    const generatedAt = await this.now();
    const { recommendations, grouped } = await this.computeAll(generatedAt);
    return { recommendations, summary: await this.summaryOf(grouped, generatedAt), generatedAt };
  }

  /**
   * 记录一次改道。
   *
   * 落 `learning_log` 而不是新建表：事件的形状（谁被拒绝、改去哪）本来就适合
   * 事件流，且 `log_kp_idx (micro_kp_id, created_at DESC)` 已经在。查询侧用
   * `DISTINCT ON (payload->>'recommended')` 取每个被拒节点的最近一次拒绝，
   * 现在是全表扫——单学生每天最多几十条，微秒级。**若 `recommendation_redirect`
   * 增长到 1 万行以上，加 `(event, created_at DESC)` 索引。**
   */
  async redirect(request: RedirectRequest): Promise<RedirectResponse> {
    const ids = [request.recommended, request.chosen];
    const found = await this.db.query<{ id: string }>(
      `SELECT id FROM knowledge_points WHERE id = ANY($1::text[])`,
      [ids],
    );
    const known = new Set(found.map((row) => row.id));
    const missing = ids.find((id) => !known.has(id));
    if (missing !== undefined) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `知识点不存在: ${missing}`,
      });
    }

    // `micro_kp_id` 记**用户选择去学的那个**（而不是被拒绝的那个）：这一列
    // 回答的是「这条事件发生在哪个知识点的学习上」，`log_kp_idx` 因此能直接
    // 查出「我在这章上改过几次道」。两个 id 都在 payload 里，信息不丢。
    await this.db.query(
      `INSERT INTO learning_log (micro_kp_id, event, payload)
       VALUES ($1, 'recommendation_redirect', $2::jsonb)`,
      [request.chosen, JSON.stringify({ recommended: request.recommended, chosen: request.chosen })],
    );
    return { ok: true };
  }

  /**
   * 一次全量重放：每个叶节点的回放事实 + 推荐列表。
   *
   * `evaluatedAt` 显式传入（控制器传数据库的 `now()`）：同一响应里的所有数字
   * 共享一个时刻，测试也能断言具体值而不是「比刚才小一点」。
   *
   * **这是唯一一处把 attempts 变成掌握度数字的地方。** 图谱端点、看板端点、
   * 推荐计算全部从这里的 `facts` 取数。此前 `GraphController` 直接读
   * `app.mastery.current`，于是同一个知识点会出现两个数：图谱说 0.9（上次
   * 作答那一刻的快照），`/api/v1/mastery/:id` 说 unseen（回放结果：一次作答
   * 都没有）。同一个事实只能有一个计算处。
   */
  private async computeAll(
    evaluatedAt: string,
  ): Promise<{
    facts: LeafFacts[];
    recommendations: RecommendationDto[];
    grouped: Map<string, EvidenceEvent[]>;
  }> {
    // 两个时刻，各管一件事，不能合并：
    //
    // · `at`（截到 UTC 日界）只用于**掌握度回放**。`MasteryService.view` 也是
    //   这么截的；不截就会得出与 `/api/v1/mastery/:id` 不一样的 `current`
    //   ——`current` 连续衰减，差几小时就差千分之一，看板与详情页会互相矛盾。
    // · `evaluatedAt`（真时刻）用于**到期判定**。`reviewDueAt` 带真实钟点，
    //   如果拿日界去比，「今天上午 10 点该复习」会被压到「今天零点已经过了吗」，
    //   于是前端（用 `new Date()` 比）显示需复验、推荐却说没到期
    //   —— 那正是票 07 验收第 5 条禁止的「图谱说有、抽考说没有」。
    const at = floorToGranularity(evaluatedAt);
    const leafRows = await this.db.query<LeafRow>(`
      SELECT n.id,
             n.name,
             n.depth,
             n.ordinal,
             n.module_id,
             m.name    AS module_name,
             m.ordinal AS module_ordinal,
             -- 内容前置（t24 第 4 条）：附录里的常数表/换算表/性质表也是叶
             -- 节点，却没有任何 chunk（图书把它们印成表格图，OCR 没出块）。
             -- 零内容的知识点推给学习者，他点进去只有空白页；与 generation 的
             -- pickTargets 同一条理由（零 chunk 生成关卡必有凭空编题，违反可
             -- 溯源红线）。
             --
             -- 判据是「有内容 chunk **或**有可用关卡」，不是单纯 chunk > 0：
             -- kp-bool 零 chunk，但有 1 张手写关卡 lv-bool-laws（4 题）和 41
             -- 条作答，把它挡掉会让一个已掌握的知识点从推荐里消失。
             --
             -- 关卡归属有两个真源，两个都要认：
             --   * levels.micro_kp_id 是 NOT NULL 外键，也是所有关卡的真实归属；
             --   * spec->meta->>microKpId 是 AI 关卡自己的声明（票 16）。
             -- 只看 spec 会把「手写关卡 spec 里没写 meta」的节点当成无关卡
             -- （测试 schema 的 lv-a 就是这种）。
             --
             -- 这是**列**而不是 WHERE 条件：图谱要用全部叶节点（它得能被点
             -- 到），只有推荐候选集该按它筛。写成 WHERE 会把图谱一起削掉。
             (EXISTS (SELECT 1 FROM chunks c WHERE c.micro_kp_id = n.id)
              OR EXISTS (SELECT 1 FROM level_items li
                           JOIN levels l ON l.id = li.level_id
                          WHERE l.micro_kp_id = n.id
                             OR l.spec->'meta'->>'microKpId' = n.id))
               AS has_content
      FROM knowledge_points n
      JOIN modules m ON m.id = n.module_id
      WHERE n.is_leaf = true
      ORDER BY n.id
    `);
    const leafIds = leafRows.map((row) => row.id);

    const [edgeRows, reviewRows, redirectRows, evidenceRows] = await Promise.all([
      this.db.query<EdgeRow>(
        `SELECT from_id, to_id FROM kp_edges WHERE kind = 'prereq' ORDER BY from_id, to_id`,
      ),
      this.db.query<ReviewRow>(
        `SELECT micro_kp_id, next_review_at FROM mastery WHERE next_review_at IS NOT NULL`,
      ),
      this.db.query<RedirectRow>(`
        SELECT DISTINCT ON (payload->>'recommended')
               payload->>'recommended' AS recommended,
               created_at
        FROM learning_log
        WHERE event = 'recommendation_redirect'
          AND payload ? 'recommended'
        ORDER BY payload->>'recommended', created_at DESC, id DESC
      `),
      loadEvidence(this.runner, leafIds),
    ]);

    const grouped = groupByMicroKp(evidenceRows);
    const reviewDue = new Map<string, string>();
    for (const row of reviewRows) {
      reviewDue.set(row.micro_kp_id, row.next_review_at.toISOString());
    }
    const redirects = new Map<string, string>();
    for (const row of redirectRows) {
      redirects.set(row.recommended, row.created_at.toISOString());
    }

    const facts: LeafFacts[] = [];
    const candidates: RecommendCandidate[] = [];
    for (const row of leafRows) {
      const snapshot = snapshotOf(grouped.get(row.id) ?? [], at);
      const reviewDueAt = reviewDue.get(row.id) ?? null;
      // `facts` 收**全部**叶节点：图谱是导航结构，每个叶节点都要能在画布上
      // 被点到（点进去看到「暂无内容」是可接受的，看不到节点不可接受）。
      facts.push({
        microKpId: row.id,
        name: row.name,
        depth: row.depth,
        ordinal: row.ordinal,
        moduleId: row.module_id,
        moduleName: row.module_name,
        moduleOrdinal: row.module_ordinal,
        // 五态来自回放（`snapshot.state`），不是 `app.mastery.state` 列。
        state: snapshot.state,
        // 证据不足不给数字（与 `MasteryService.toView` 同一条规则）：一个做了
        // 1 题的节点不该以「当前 0.31」的身份参与排序，那会把「刚摸了一下」
        // 误排成「学得很差」；界面上也不该把它画成 31%。
        percent: snapshot.evidenceSufficient ? snapshot.current : null,
        snapshot,
        reviewDueAt,
      });
      // `candidates` 只收有内容的：推荐是「该学什么」，推一条点进去空白页的
      // 节点就是把人往墙角引。快照照算不误 —— 复用上面那次回放，不额外查库。
      if (!row.has_content) continue;
      candidates.push({
        microKpId: row.id,
        name: row.name,
        achieved: snapshot.evidenceSufficient ? snapshot.achieved : null,
        current: snapshot.evidenceSufficient ? snapshot.current : null,
        attemptCount: snapshot.attemptCount,
        variantCount: snapshot.variantCount,
        evidenceSufficient: snapshot.evidenceSufficient,
        halfLifeDays: snapshot.halfLifeDays,
        lastEvidenceAt: snapshot.lastEvidenceAt,
        reviewDueAt,
        moduleOrdinal: row.module_ordinal,
        depth: row.depth,
        ordinal: row.ordinal,
      });
    }

    const edges: RecommendEdge[] = edgeRows.map((row) => ({ from: row.from_id, to: row.to_id }));

    const picked = recommend({ candidates, edges, redirects, now: evaluatedAt });

    const moduleNameOf = new Map(leafRows.map((row) => [row.id, row.module_name]));
    const recommendations: RecommendationDto[] = picked.map((item) => ({
      microKpId: item.microKpId,
      name: item.name,
      moduleName: moduleNameOf.get(item.microKpId) ?? '',
      // `facts` 在 engine 里是 `readonly`（纯函数不修改入参），契约里的数组是可变
      // 的 zod 输出类型。拷一份而不是断言：断言只是让编译器闭嘴，拷贝才真的
      // 保证后续没人能把同一个数组共享给两个响应。顺序与内容不变。
      reason: { kind: item.reason.kind, facts: [...item.reason.facts] },
    }));

    return { facts, recommendations, grouped };
  }

  /** 看板用：把 `computeAll` 的结果里加上今日摘要。 */
  private async summaryOf(
    grouped: Map<string, EvidenceEvent[]>,
    evaluatedAt: string,
  ): Promise<TodaySummary> {
    // 复用 `computeAll` 已经取回的分组证据，不再查第二遍：`newlyMastered` 要把
    // 每个知识点的证据分别回放到今天零点，用的就是同一批 `EvidenceEvent`。
    return this.summary(grouped, evaluatedAt);
  }

  /**
   * 当天零点（UTC 日界）。
   *
   * 与 `floorToGranularity` 同口径：掌握度的评估时刻一律截到 UTC 日界，所以
   * 「今天」也必须指同一个边界。不能用 SQL 的 `date_trunc('day', now())` ——
   * 那个结果取决于连接会话的 TimeZone，换个部署环境「今天答了几题」就会差
   * 几个小时，而响应里其他数字都是 UTC 日界算的。
   */
  private dayStart(evaluatedAt: string): string {
    return `${evaluatedAt.slice(0, 10)}T00:00:00.000Z`;
  }

  /**
   * 今日学习摘要。
   *
   * `available` 先问「这张表在不在」（`to_regclass`），而不是「数字是不是 0」：
   * 「今天答了 0 题」和「作答记录还没接通」是两件事，前者是结论、后者是未知。
   * 与「证据不足不给 0%」同一条原则：没有数据源就不给数字。
   *
   * `newlyMastered` 不是查出来的，是**算出来的**：对今天有证据的每个知识点，
   * 分别回放到「今天零点」和「现在」，比较两次的五态。查 `app.mastery.state`
   * 是不行的——那是缓存，昨天写过什么它不记得。
   */
  private async summary(
    grouped: Map<string, EvidenceEvent[]>,
    evaluatedAt: string,
  ): Promise<TodaySummary> {
    const availability = await this.db.query<AvailabilityRow>(
      `SELECT to_regclass('attempts') IS NOT NULL AS available`,
    );
    if (availability[0]?.available !== true) {
      return { available: false, answered: 0, knowledgePoints: 0, newlyMastered: 0 };
    }

    const dayStart = this.dayStart(evaluatedAt);
    const counts = await this.db.query<TodayCountRow>(
      `
      SELECT count(*)::int                    AS answered,
             count(DISTINCT micro_kp_id)::int AS knowledge_points
      FROM attempts
      WHERE created_at >= $1::timestamptz
    `,
      [dayStart],
    );
    const row = counts[0];

    let newlyMastered = 0;
    for (const events of grouped.values()) {
      const today = events.filter((event) => Date.parse(event.at) >= Date.parse(dayStart));
      if (today.length === 0) continue;
      const before = snapshotOf(
        events.filter((event) => Date.parse(event.at) < Date.parse(dayStart)),
        dayStart,
      );
      const nowSnapshot = snapshotOf(events, evaluatedAt);
      if (nowSnapshot.state === 'mastered' && before.state !== 'mastered') newlyMastered += 1;
    }

    return {
      available: true,
      answered: row?.answered ?? 0,
      knowledgePoints: row?.knowledge_points ?? 0,
      newlyMastered,
    };
  }
}
