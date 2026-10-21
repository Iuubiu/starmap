import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  ReviewCompleteResponse,
  ReviewOutcome,
  ReviewQueueEntry,
  ReviewQueueResponse,
  ReviewQuestion,
  ReviewRound,
  ReviewRoundDetailResponse,
  ReviewRoundStartResponse,
} from '@starmap/api-contract';
import {
  REVIEW_ITEMS_MAX,
  REVIEW_ITEMS_MIN,
  advanceReviewSchedule,
  interleaveReviewItems,
  overdueDays,
  reviewIntervalDays,
  reviewPassed,
  selectReviewItems,
  type ReviewCandidate,
} from '@starmap/engine';
import { DatabaseService } from '../db/database.service.js';
import { MasteryService } from '../mastery/mastery.service.js';
import type { Runner } from '../mastery/repository.js';
import {
  completeReviewRound,
  dueReviewCandidates,
  findReviewRound,
  insertReviewRound,
  attemptedItemIds,
  reviewItemPool,
  reviewRoundAnswers,
  reviewRoundItems,
  setReviewSchedule,
  writeReviewLog,
  type ReviewItemRow,
  type ReviewRoundRow,
} from './repository.js';

type ItemKind = 'fact' | 'concept' | 'comprehensive';

type SpecShape = { items?: { id: string; kind?: string }[] };

function optionTexts(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options.map((option) => String(option));
}

/**
 * 到期的知识点可能不止一个；一轮复验最多考 5 题，要尽量覆盖多个知识点 ——
 * 这就是票 07 验收第 1 条「多个知识点交错出现而不是同一个连考」。
 *
 * 抽题分两步，两步都不随机（复验记录里的「这次考了哪几题」必须可复现）：
 *   1. 每个知识点各自 `selectReviewItems` 抽 3–5 题（跨变式组、不重做原题）；
 *   2. `interleaveReviewItems` 把它们轮转交错成一份题单，取前 5 题。
 */
@Injectable()
export class ReviewService {
  private readonly mastery: MasteryService;

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {
    // 现场实例化，与 gating/mastery 控制器一致：不改共享的 app.module.ts。
    this.mastery = new MasteryService(db);
  }

  private get runner(): Runner {
    return (sql, params) => this.db.query(sql, params ?? []);
  }

  /**
   * 此刻到期的复验队列。
   *
   * `dueReviewCandidates` 的 SQL 过滤条件（`next_review_at IS NOT NULL`、
   * `<= $1`、`is_leaf`）与图谱「需复验」那一档同源，所以「图谱说有、抽考
   * 说没有」在这个接口上不可能发生 —— 两边读的是同一列、同一个比较规则
   * （`packages/engine/src/review.ts` 的 `isReviewDue` 与
   * `apps/web/src/graph/status.ts` 的 `toDisplayStatus` 逐字相同）。
   */
  async queue(now: string): Promise<ReviewQueueResponse> {
    const candidates = await dueReviewCandidates(this.runner, now);
    const entries: ReviewQueueEntry[] = [];

    for (const candidate of candidates) {
      const pool = await this.poolWithKinds(this.runner, candidate.micro_kp_id);
      entries.push({
        microKpId: candidate.micro_kp_id,
        name: candidate.name,
        nextDueAt: candidate.next_review_at.toISOString(),
        overdueDays: overdueDays(candidate.next_review_at.toISOString(), now),
        reviewStage: candidate.review_stage,
        intervalDays: reviewIntervalDays(candidate.review_stage),
        availableItemCount: pool.length,
      });
    }

    return { due: entries };
  }

  /**
   * 开始一轮复验。
   *
   * ## 题单为什么现在就要写下来
   *
   * 判分发生在学习者把题做完之后。若那时才现算「考哪几题」，中间这段时间里
   * 他又做了别的题，`selectReviewItems` 的输入变了，判出来的题单与学习者
   * 屏幕上看到的就不是同一批 —— 于是「这次复验没过」无法对应到具体的题。
   * 会话与逐题清单在开始时就落库，判分只读这份清单。
   */
  async start(now: string): Promise<ReviewRoundStartResponse> {
    const candidates = await dueReviewCandidates(this.runner, now);
    if (candidates.length === 0) {
      throw new ConflictException({
        code: 'CONFLICT',
        message:
          '现在没有到期的复验。已掌握的知识点会按 1/3/7/21/60 天回来，到期后在「复验」页就能看到。',
        details: { due: [] },
      });
    }

    const details = new Map<string, ReviewItemRow & { kind: ItemKind }>();
    const groups: ReviewCandidate[][] = [];
    const kinds = new Map<string, ItemKind>();

    for (const candidate of candidates) {
      const pool = await this.poolWithKinds(this.runner, candidate.micro_kp_id);
      if (pool.length === 0) continue;

      const seen = await attemptedItemIds(this.runner, candidate.micro_kp_id);
      const picked = selectReviewItems(
        pool.map((item) => ({ itemId: item.item_id, variantGroup: item.variant_group })),
        seen,
      );
      if (picked.length === 0) continue;

      for (const row of pool) {
        details.set(row.item_id, row);
        kinds.set(row.item_id, row.kind);
      }
      groups.push(picked);
    }

    if (groups.length === 0) {
      throw new ConflictException({
        code: 'CONFLICT',
        message:
          '到期的知识点都还没有可以复验的题（题库里没有类型登记在 spec 里的判定题），所以这次抽不出题单。',
        details: { due: candidates.map((candidate) => candidate.micro_kp_id) },
      });
    }

    // 一轮 3–5 题（spec.md:407）。交错之后取前 5 题，前缀仍然满足「相邻两题
    // 来自不同知识点」—— 轮转的第一轮就已经保证了。
    const chosen = interleaveReviewItems(groups).slice(0, REVIEW_ITEMS_MAX);

    // 「每次 3–5 题」是票 07 验收第 1 条的下界，不是建议值。题池不够 3 题时
    // 开一轮 2 题的复验，会让 `reviewPassed(2,2)` 判成「通过」并把间隔推进
    // 一档 —— 三题才叫复验，两题叫抽查。宁可 409 说清「题不够」，也不要开出
    // 一轮判不准的会话。
    if (chosen.length < REVIEW_ITEMS_MIN) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `到期的知识点一共只凑得出 ${chosen.length} 道可复验的题，少于一轮至少要的 ${REVIEW_ITEMS_MIN} 道。给这些知识点补几道不同变式组的判定题之后再来。`,
        details: { due: candidates.map((candidate) => candidate.micro_kp_id) },
      });
    }

    const names = new Map(candidates.map((candidate) => [candidate.micro_kp_id, candidate.name]));
    const roundId = randomUUID();
    const items: ReviewQuestion[] = [];

    for (const [index, picked] of chosen.entries()) {
      const row = details.get(picked.itemId);
      if (!row) continue;
      items.push({
        ordinal: index + 1,
        itemId: row.item_id,
        microKpId: row.micro_kp_id,
        microKpName: names.get(row.micro_kp_id) ?? row.micro_kp_id,
        variantGroup: row.variant_group,
        stem: row.stem,
        options: optionTexts(row.options),
        explainCorrect: row.explain_correct,
        explainWrong: row.explain_wrong,
        misconceptionTags: row.misconception_tags ?? [],
      });
    }

    // ordinal 必须与 `chosen` 的下标一致（交错顺序是内容的一部分），所以
    // 万一某题回表失败也不能让它后面的题整体前移。
    for (const [index, item] of items.entries()) item.ordinal = index + 1;

    const microKpIds = [...new Set(items.map((item) => item.microKpId))];

    const client = await this.db.connection.connect();
    try {
      await client.query('BEGIN');
      const run: Runner = async (sql, params) => {
        const result = await client.query(sql, params as unknown[]);
        return result.rows as Record<string, unknown>[];
      };
      await insertReviewRound(run, {
        id: roundId,
        microKpIds,
        items: items.map((item) => ({
          microKpId: item.microKpId,
          itemId: item.itemId,
          variantGroup: item.variantGroup,
        })),
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    return {
      round: {
        roundId,
        itemCount: items.length,
        createdAt: now,
        completedAt: null,
        verdict: null,
        correctCount: null,
      },
      items,
      microKpIds,
    };
  }

  /**
   * 判分：按知识点聚合、推进排期、留痕。
   *
   * ## 为什么必须幂等
   *
   * 推进排期不是幂等操作（连点两次会把 stage 推两档）。判分请求会因为网络
   * 重试、刷新页面后重交而重复到达，所以会话一旦写死结果，后续请求原样
   * 返回存下来的 `outcomes`，不再动排期。
   *
   * ## 为什么按知识点分开判定
   *
   * 间隔排期是每个知识点各自一条。A 记得牢、B 忘了，不能让 B 的遗忘把 A 的
   * 间隔一起退回去 —— 那会让一个薄弱点永久拖住整片复习计划。
   */
  async complete(roundId: string): Promise<ReviewCompleteResponse> {
    const client = await this.db.connection.connect();

    try {
      let roundRow: ReviewRoundRow;
      let outcomes: ReviewOutcome[];

      await client.query('BEGIN');
      try {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `review:${roundId}`,
        ]);

        const run: Runner = async (sql, params) => {
          const result = await client.query(sql, params as unknown[]);
          return result.rows as Record<string, unknown>[];
        };

        const found = await findReviewRound(run, roundId);
        if (!found) {
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: `复验会话不存在: ${roundId}`,
          });
        }

        if (found.verdict !== null) {
          // 已经判过：结果整块读回，排期一律不再动。
          roundRow = found;
          outcomes = outcomesOf(found.outcomes);
          await client.query('COMMIT');
        } else {
          const items = await reviewRoundItems(run, roundId);
          const answers = await reviewRoundAnswers(run, roundId);

          if (items.length === 0) {
            throw new UnprocessableEntityException({
              code: 'VALIDATION_FAILED',
              message: '这一轮复验没有题目，无法判分。',
              details: { missingItemIds: [] },
            });
          }

          const answered = new Set(answers.map((answer) => answer.item_id));
          const missing = items
            .filter((item) => !answered.has(item.item_id))
            .map((item) => item.item_id);
          if (missing.length > 0) {
            throw new UnprocessableEntityException({
              code: 'VALIDATION_FAILED',
              message: `这一轮还有 ${missing.length} 道题没答完，判分需要全部答完：${missing.join('、')}`,
              details: { missingItemIds: missing },
            });
          }

          const completedAt = await this.db.now();
          const byItem = new Map(answers.map((answer) => [answer.item_id, answer]));
          const microKpIds = found.micro_kp_ids;
          const names = new Map<string, string>();
          for (const microKpId of microKpIds) {
            const rows = await run(`SELECT name FROM knowledge_points WHERE id = $1`, [microKpId]);
            names.set(microKpId, String(rows[0]?.['name'] ?? microKpId));
          }

          outcomes = [];
          let totalCorrect = 0;
          let allPassed = true;

          for (const microKpId of microKpIds) {
            const own = items.filter((item) => item.micro_kp_id === microKpId);
            if (own.length === 0) continue;

            const correctIds: string[] = [];
            const wrongIds: string[] = [];
            for (const item of own) {
              if (byItem.get(item.item_id)?.correct === true) correctIds.push(item.item_id);
              else wrongIds.push(item.item_id);
            }
            totalCorrect += correctIds.length;

            const passed = reviewPassed(correctIds.length, own.length);
            if (!passed) allPassed = false;

            const stageRows = await run(`SELECT review_stage FROM mastery WHERE micro_kp_id = $1`, [
              microKpId,
            ]);
            const currentStage = Number(stageRows[0]?.['review_stage'] ?? 0);
            const schedule = advanceReviewSchedule({ stage: currentStage, passed, completedAt });

            await setReviewSchedule(run, microKpId, schedule);
            await writeReviewLog(run, {
              microKpId,
              event: passed ? 'review_passed' : 'review_failed',
              payload: {
                roundId,
                stage: schedule.stage,
                nextDueAt: schedule.nextDueAt,
                intervalDays: reviewIntervalDays(schedule.stage),
                correct: correctIds.length,
                total: own.length,
                correctItemIds: correctIds,
                wrongItemIds: wrongIds,
              },
            });

            outcomes.push({
              microKpId,
              name: names.get(microKpId) ?? microKpId,
              correct: correctIds.length,
              total: own.length,
              passed,
              verdict: passed ? 'passed' : 'failed',
              stage: schedule.stage,
              nextDueAt: schedule.nextDueAt,
              correctItemIds: correctIds,
              wrongItemIds: wrongIds,
              message: passed
                ? `答对 ${correctIds.length} / ${own.length}，下次 ${reviewIntervalDays(schedule.stage)} 天后再复验。`
                : `答对 ${correctIds.length} / ${own.length}，没通过；间隔退回 ${reviewIntervalDays(schedule.stage)} 天，${wrongIds.length} 道错题会先重讲。`,
            });
          }

          await completeReviewRound(run, roundId, {
            correctCount: totalCorrect,
            verdict: allPassed ? 'passed' : 'failed',
            completedAt,
            outcomes,
          });

          roundRow = {
            ...found,
            correct_count: totalCorrect,
            verdict: allPassed ? 'passed' : 'failed',
            completed_at: new Date(completedAt),
            outcomes,
          };

          await client.query('COMMIT');
        }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }

      const mastery = [];
      for (const microKpId of roundRow.micro_kp_ids) {
        mastery.push(await this.mastery.view(microKpId, await this.db.now()));
      }

      return { round: toRound(roundRow), outcomes, mastery };
    } finally {
      client.release();
    }
  }

  /** 读一次已判分（或未判分）的会话。 */
  async detail(roundId: string): Promise<ReviewRoundDetailResponse> {
    const found = await findReviewRound(this.runner, roundId);
    if (!found) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `复验会话不存在: ${roundId}`,
      });
    }

    const items = await reviewRoundItems(this.runner, roundId);
    const names = new Map<string, string>();
    for (const microKpId of found.micro_kp_ids) {
      const rows = await this.runner(`SELECT name FROM knowledge_points WHERE id = $1`, [microKpId]);
      names.set(microKpId, String(rows[0]?.['name'] ?? microKpId));
    }

    const mastery = [];
    for (const microKpId of found.micro_kp_ids) {
      mastery.push(await this.mastery.view(microKpId, await this.db.now()));
    }

    return {
      round: toRound(found),
      outcomes: outcomesOf(found.outcomes),
      items: items.map((item) => ({
        ordinal: item.ordinal,
        itemId: item.item_id,
        microKpId: item.micro_kp_id,
        microKpName: names.get(item.micro_kp_id) ?? item.micro_kp_id,
        variantGroup: item.variant_group,
        stem: item.stem,
        options: optionTexts(item.options),
        explainCorrect: item.explain_correct,
        explainWrong: item.explain_wrong,
        misconceptionTags: item.misconception_tags ?? [],
      })),
      mastery,
    };
  }

  /**
   * 复验池：`reviewItemPool()` 的候选里**类型能从关卡 spec 读到**的题。
   *
   * 池的优先级（core 优先、全无 core 才回退 practice）在 repository 层，
   * 这里不再多一道过滤 —— 两处都判池会让「到底回退没回退」有两个真源。
   *
   * 类型决定这条证据的半衰期（14/30/45 天）。取不到类型时 `AttemptsService`
   * 会回落成 concept，半衰期就蒙错了 —— 所以这种题不进复验。AI 关卡
   * （`assembleLevelSpec()`）每题都写 `kind: 'concept'`，所以回退路径上的题
   * 都能过这一关；过不了的都是外部手写但 spec 里漏了 kind 的脏数据。
   */
  private async poolWithKinds(
    run: Runner,
    microKpId: string,
  ): Promise<(ReviewItemRow & { kind: ItemKind })[]> {
    const rows = await reviewItemPool(run, microKpId);
    const usable: (ReviewItemRow & { kind: ItemKind })[] = [];

    const specs = new Map<string, Map<string, ItemKind>>();
    for (const row of rows) {
      let kinds = specs.get(row.level_id);
      if (!kinds) {
        const specRows = await run(`SELECT spec FROM levels WHERE id = $1`, [row.level_id]);
        kinds = kindMapOf(specRows[0]?.['spec']);
        specs.set(row.level_id, kinds);
      }
      const kind = kinds.get(row.item_id);
      if (kind) usable.push({ ...row, kind });
    }

    return usable;
  }
}

function kindMapOf(spec: unknown): Map<string, ItemKind> {
  const shape = spec as SpecShape | null;
  const map = new Map<string, ItemKind>();
  for (const item of shape?.items ?? []) {
    const kind = item.kind;
    if (kind === 'fact' || kind === 'concept' || kind === 'comprehensive') {
      map.set(String(item.id), kind);
    }
  }
  return map;
}

function toRound(row: ReviewRoundRow): ReviewRound {
  return {
    roundId: row.id,
    itemCount: row.item_count,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    verdict: row.verdict === 'passed' || row.verdict === 'failed' ? row.verdict : null,
    correctCount: row.correct_count,
  };
}

function outcomesOf(raw: unknown): ReviewOutcome[] {
  return Array.isArray(raw) ? (raw as ReviewOutcome[]) : [];
}
