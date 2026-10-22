import type { ReviewCandidate } from '@starmap/engine';
import type { Runner } from '../mastery/repository.js';

/**
 * 复验的数据访问层。
 *
 * 只用 `Runner`（一条 SQL 一个查询）而不带事务：排期推进与复验判分要事务，
 * 事务由 service 层持有并把 `run` 传进来 —— 与本仓库 mastery/gating 两个
 * 模块同一个形状（`Runner` 类型从 `../mastery/repository.js` 复用，不另立
 * 一套）。
 *
 * SQL 不写 `app.` 前缀：schema 由连接的 `search_path` 决定。
 */

/** 一个够格被排期的知识点：已掌握、叶节点、有排期。 */
export type DueCandidateRow = {
  micro_kp_id: string;
  name: string;
  next_review_at: Date;
  review_stage: number;
};

/**
 * 取所有**此刻到期**的已掌握叶节点。
 *
 * 三条件缺一不可：
 * - `next_review_at IS NOT NULL` —— 没排期就谈不上到期。这一列是图谱
 *   「需复验」那一档的唯一判据（0003 迁移注释），所以过滤条件必须与图谱
 *   完全一致，否则会出现「图谱说有、抽考说没有」（票 07 验收第 5 条）。
 * - `next_review_at <= $1` —— 与 `packages/engine/src/review.ts` 的
 *   `isReviewDue` 逐字同一条规则（含「恰好等于也算到期」）。不在这里自己
 *   写第二个比较：前端 `toDisplayStatus`、引擎 `isReviewDue`、这条 SQL
 *   三处必须是同一个语义。这里之所以只能用 SQL 表达，是因为候选集要由
 *   数据库筛（可能上千个知识点），不能全取出来在内存里过滤。
 * - `is_leaf` —— ADR-0004：掌握度只挂叶节点。折叠节点的 `mastery` 行
 *   不该存在，万一存在（历史脏数据）也不能让复验去考它。
 */
export async function dueReviewCandidates(run: Runner, now: string): Promise<DueCandidateRow[]> {
  const rows = await run(
    `SELECT m.micro_kp_id, k.name, m.next_review_at, m.review_stage
       FROM mastery m
       JOIN knowledge_points k ON k.id = m.micro_kp_id
      WHERE m.next_review_at IS NOT NULL
        AND m.next_review_at <= $1::timestamptz
        AND k.is_leaf = true
      ORDER BY m.next_review_at ASC, m.micro_kp_id ASC`,
    [now],
  );
  return rows as unknown as DueCandidateRow[];
}

/** 一道题的完整信息（判题、取题干、记变式组都要）。 */
export type ReviewItemRow = {
  item_id: string;
  level_id: string;
  micro_kp_id: string;
  variant_group: string;
  stem: string;
  options: unknown;
  answer: unknown;
  explain_correct: string;
  explain_wrong: string;
  misconception_tags: string[] | null;
  knowledge_kind: string | null;
};

/**
 * 取一个知识点可用于复验的题目池。
 *
 * ## 池的优先级：core 优先，一道 core 都没有才回退到 practice
 *
 * 先前这里只取 `pool = 'quiz'`（core 池落在表里就是 `'quiz'`，两套词表，
 * 见 0010 迁移的注释）。理由写得很硬：「把补救练习抽进复验等于让学习者用
 * 『刚才讲过的原题』证明自己还记得 —— 那不是复验」。
 *
 * 那个理由针对的是**有 core 题可选却去抽练习题**这种偷懒。它不适用于
 * 另一种情况：某个知识点**根本没有 core 题**。AI 生成的关卡只进 practice
 * 池（票 16 验收④的红线，`levels_ai_practice_only` 触发器在库层拦），
 * 而部分知识点只有 AI 关卡。对这些知识点，只取 core 的结果不是「保证复验
 * 质量」，而是「永远无法复验」：`selectReviewItems()` 拿到空池 → 题单凑不满
 * 3 道 → `POST /review/rounds` 一律 409。
 *
 * 两害相权：用练习题复验只是质量略低（`selectReviewItems()` 已经优先选
 * 没做过的题、按变式组轮转，不会总是同一道原题），而无法复验是功能缺失 ——
 * 已掌握的知识点永远不会被抽到，「掌握度会回落」这件事对这个知识点就不存在。
 * 所以顺序是 **有 core 用 core，全无 core 才回退**，且绝不在同一个知识点上
 * 把两种池混着抽（混抽会让「这次为什么抽到这道题」无法解释）。
 *
 * 同时排除**不属于任何关卡 spec.items 的题**：`knowledge_kind` 只能从 spec
 * 里读（`level_items` 表没有这一列），而证据的衰减速度依赖它。取不到类型的
 * 题进了复验会被当成 concept（`AttemptsService` 的回落），半衰期蒙错。
 * 由 service 层用 `spec` 里的 `items` 交叉筛选，这里只负责取出候选。
 */
export async function reviewItemPool(run: Runner, microKpId: string): Promise<ReviewItemRow[]> {
  const rows = await run(
    `WITH core AS (
       SELECT i.id AS item_id, i.level_id, l.micro_kp_id, i.variant_group, i.stem,
              i.options, i.answer, i.explain_correct, i.explain_wrong,
              i.misconception_tags, l.spec
         FROM level_items i
         JOIN levels l ON l.id = i.level_id
        WHERE l.micro_kp_id = $1
          AND i.pool = 'quiz'
     ), fallback AS (
       SELECT i.id AS item_id, i.level_id, l.micro_kp_id, i.variant_group, i.stem,
              i.options, i.answer, i.explain_correct, i.explain_wrong,
              i.misconception_tags, l.spec
         FROM level_items i
         JOIN levels l ON l.id = i.level_id
        WHERE l.micro_kp_id = $1
          AND i.pool = 'practice'
          AND NOT EXISTS (SELECT 1 FROM core)
     )
     SELECT item_id, level_id, micro_kp_id, variant_group, stem, options, answer,
            explain_correct, explain_wrong, misconception_tags,
            NULL::text AS knowledge_kind
       FROM (SELECT * FROM core UNION ALL SELECT * FROM fallback) AS pool
      ORDER BY variant_group ASC, item_id ASC`,
    [microKpId],
  );
  return rows as unknown as ReviewItemRow[];
}

/**
 * 这个知识点这次抽题用的是哪个池。
 *
 * 不参与契约形状（不为它加一个接口字段）：它只用于测试断言与日志，
 * 让「回退到底发生了没有」可被验证，而不是靠推断 `item_id` 属于哪个池。
 */
export async function reviewPoolKind(
  run: Runner,
  microKpId: string,
): Promise<'core' | 'practice-fallback'> {
  const rows = await run(
    `SELECT 1 AS hit FROM level_items i JOIN levels l ON l.id = i.level_id
      WHERE l.micro_kp_id = $1 AND i.pool = 'quiz' LIMIT 1`,
    [microKpId],
  );
  return rows.length > 0 ? 'core' : 'practice-fallback';
}

/**
 * 学习者在**某个**知识点上已经做过的题目 id。
 *
 * 只算计分证据（`counts_toward_mastery = true`）：深究段的作答是为了暴露
 * 不会，把它算成「这题做过了，复验别再考」会让补救材料反过来减少复验覆盖。
 */
export async function attemptedItemIds(
  run: Runner,
  microKpId: string,
): Promise<string[]> {
  const rows = await run(
    `SELECT DISTINCT item_id
       FROM attempts
      WHERE micro_kp_id = $1
        AND counts_toward_mastery = true`,
    [microKpId],
  );
  return (rows as unknown as { item_id: string }[]).map((row) => row.item_id);
}

/** 写入一次复验会话与它的逐题清单。 */
export async function insertReviewRound(
  run: Runner,
  round: {
    id: string;
    microKpIds: string[];
    items: { microKpId: string; itemId: string; variantGroup: string }[];
  },
): Promise<void> {
  await run(
    `INSERT INTO review_rounds (id, micro_kp_ids, item_count)
     VALUES ($1, $2::text[], $3)`,
    [round.id, round.microKpIds, round.items.length],
  );

  for (const [index, item] of round.items.entries()) {
    await run(
      `INSERT INTO review_round_items (round_id, ordinal, micro_kp_id, item_id, variant_group)
       VALUES ($1, $2, $3, $4, $5)`,
      [round.id, index + 1, item.microKpId, item.itemId, item.variantGroup],
    );
  }
}

export type ReviewRoundRow = {
  id: string;
  micro_kp_ids: string[];
  item_count: number;
  correct_count: number | null;
  verdict: string | null;
  outcomes: unknown;
  created_at: Date;
  completed_at: Date | null;
};

export async function findReviewRound(
  run: Runner,
  roundId: string,
): Promise<ReviewRoundRow | undefined> {
  const rows = await run(
    `SELECT id, micro_kp_ids, item_count, correct_count, verdict, outcomes, created_at, completed_at
       FROM review_rounds
      WHERE id = $1`,
    [roundId],
  );
  return rows[0] as unknown as ReviewRoundRow | undefined;
}

export type ReviewRoundItemRow = {
  ordinal: number;
  micro_kp_id: string;
  item_id: string;
  variant_group: string;
  stem: string;
  options: unknown;
  answer: unknown;
  explain_correct: string;
  explain_wrong: string;
  misconception_tags: string[] | null;
};

/** 会话的逐题清单，按 `ordinal`（交错后的呈现顺序）。 */
export async function reviewRoundItems(
  run: Runner,
  roundId: string,
): Promise<ReviewRoundItemRow[]> {
  const rows = await run(
    `SELECT r.ordinal, r.micro_kp_id, r.item_id, r.variant_group,
            i.stem, i.options, i.answer, i.explain_correct, i.explain_wrong,
            i.misconception_tags
       FROM review_round_items r
       JOIN level_items i ON i.id = r.item_id
      WHERE r.round_id = $1
      ORDER BY r.ordinal ASC`,
    [roundId],
  );
  return rows as unknown as ReviewRoundItemRow[];
}

/**
 * 判分时读「这一回复验里的作答」。
 *
 * 按 `review_round_id` 取而不是按时间窗：学习者可能同时开着普通关卡，时间窗
 * 会把别人的作答算进复验；而 `review_round_id` 是判分前就写死的归属。
 * 每题取**最后一次**（`DISTINCT ON`）：同题重交只算最后一次，与出口门控一致。
 */
export type ReviewAnswerRow = {
  micro_kp_id: string;
  item_id: string;
  correct: boolean;
  created_at: Date;
};

export async function reviewRoundAnswers(
  run: Runner,
  roundId: string,
): Promise<ReviewAnswerRow[]> {
  const rows = await run(
    `SELECT DISTINCT ON (item_id) micro_kp_id, item_id, correct, created_at
       FROM attempts
      WHERE review_round_id = $1
      ORDER BY item_id, created_at DESC, id DESC`,
    [roundId],
  );
  return rows as unknown as ReviewAnswerRow[];
}

/** 把会话判分结果写死。 */
export async function completeReviewRound(
  run: Runner,
  roundId: string,
  result: {
    correctCount: number;
    verdict: 'passed' | 'failed';
    completedAt: string;
    outcomes: unknown;
  },
): Promise<void> {
  await run(
    `UPDATE review_rounds
        SET correct_count = $2, verdict = $3, completed_at = $4::timestamptz,
            outcomes = $5::jsonb
      WHERE id = $1`,
    [roundId, result.correctCount, result.verdict, result.completedAt, JSON.stringify(result.outcomes)],
  );
}

/**
 * 推进一个知识点的排期。
 *
 * ## 为什么单独一条 SQL 而不是扩 `upsertMastery`
 *
 * `upsertMastery`（`../mastery/repository.ts`）是**证据回放的结果**的写入口：
 * 它写的是 achieved/current/state/attempt_count/variant_count，全部由
 * `replayMastery` 算出来。排期不来自证据回放 —— 它来自「这一回复验过没过」
 * 这个事件，而且普通作答（`POST /attempts`）不该动它。两件事写同一个函数，
 * 迟早会有人在普通作答路径里顺手推进 stage。
 *
 * ## 为什么 stage 与 next_due 必须一起写
 *
 * 两个值描述同一个状态（序列位置 → 对应间隔）。分两次写、中间崩溃，就会
 * 留下「stage=3 但 3 天后到期」这种自相矛盾的排期，而它看起来完全合法。
 */
export async function setReviewSchedule(
  run: Runner,
  microKpId: string,
  schedule: { stage: number; nextDueAt: string | null },
): Promise<void> {
  await run(
    `UPDATE mastery
        SET review_stage = $2,
            next_review_at = $3::timestamptz
      WHERE micro_kp_id = $1`,
    [microKpId, schedule.stage, schedule.nextDueAt],
  );
}

/** 复验判定的留痕：与门控同一条约定（事件名 + 完整 payload）。 */
export async function writeReviewLog(
  run: Runner,
  log: { microKpId: string; event: string; payload: unknown },
): Promise<void> {
  await run(
    `INSERT INTO learning_log (session_id, micro_kp_id, event, payload)
     VALUES (NULL, $1, $2, $3::jsonb)`,
    [log.microKpId, log.event, JSON.stringify(log.payload)],
  );
}
