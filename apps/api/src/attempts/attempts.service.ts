import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AttemptRecord, AttemptSubmitRequest, AttemptSubmitResponse } from '@starmap/api-contract';
import type { KnowledgeKind } from '@starmap/engine';
import { DatabaseService } from '../db/database.service.js';
import { groupByMicroKp, snapshotOf } from '../mastery/evidence.js';
import { judgeAnswer, optionCount } from '../mastery/judge.js';
import { MasteryService } from '../mastery/mastery.service.js';
import { findItem, loadEvidence, upsertMastery, type Runner } from '../mastery/repository.js';

/**
 * 「这一段算不算掌握度证据」。
 *
 * ## 为什么只看步骤类型，不看 `level_items.pool`
 *
 * 同一道题可以在两个关卡里有不同的 pool：在判定关卡里它是 `core`，被自制
 * 关卡重新打包成练习时它是 `practice`。pool 是**内容侧的池子归属**（决定它
 * 出现在哪个池、怎么被市场挑走），不是「这次作答算不算数」。
 *
 * 真正决定算不算数的是**学习者在哪里答的**：深究与进一步讲解这两段**全程
 * 不扣掌握度**（spec 需求 17），因为它们存在的意义是让学习者安全地暴露
 * 不会。若把那里的作答算进 BKT，学生会在一两次之后学会装懂，那一段就废了。
 */
const REMEDIATION_STEPS = new Set(['deepen', 'reteach']);

type StepRow = { id: string; kind: string; itemIds: string[] };

type SpecShape = {
  steps?: StepRow[];
  items?: { id: string; kind?: string }[];
};

type AttemptRow = {
  id: string;
  micro_kp_id: string;
  item_id: string;
  level_id: string | null;
  variant_group: string;
  correct: boolean;
  attempt_no: number;
  counts_toward_mastery: boolean;
  knowledge_kind: string | null;
  created_at: Date;
};

function stepsOf(spec: unknown): StepRow[] {
  const shape = spec as SpecShape | null;
  if (!shape || !Array.isArray(shape.steps)) return [];
  return shape.steps
    .filter((step): step is StepRow => Boolean(step) && Array.isArray(step.itemIds))
    .map((step) => ({ id: String(step.id), kind: String(step.kind), itemIds: step.itemIds.map(String) }));
}

/**
 * 取题目的知识类型（决定半衰期 14 / 30 / 45 天）。
 *
 * 只存在于 spec 里，所以必须在**写证据的那一刻**解析并落进
 * `attempts.knowledge_kind`。事后回放时再查 spec 是不行的：spec 可以被自制
 * 关卡覆盖，改一次就让全部历史证据的衰减速度一起变。
 */
function kindOfItem(spec: unknown, itemId: string): KnowledgeKind | null {
  const shape = spec as SpecShape | null;
  const item = shape?.items?.find((candidate) => candidate.id === itemId);
  const kind = item?.kind;
  if (kind === 'fact' || kind === 'concept' || kind === 'comprehensive') return kind;
  return null;
}

@Injectable()
export class AttemptsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    private readonly mastery: MasteryService,
  ) {}

  /**
   * 记录一次作答并重算掌握度。
   *
   * 三步必须在**同一个事务**里：写 attempt、按需更新 mastery 行、回读作答行
   * 构造响应。分开做的后果是「证据记了但掌握度没动」或反过来的不一致状态，
   * 而这种状态没有任何后台任务会发现 —— 下一次读到的数字会莫名少一次。
   */
  async record(request: AttemptSubmitRequest): Promise<AttemptSubmitResponse> {
    // 判题需要题目 + 关卡 spec，这两样在事务外读就够（只读，且不会变）
    const item = await findItem((sql, params) => this.db.query(sql, params ?? []), request.itemId);
    if (!item) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `题目不存在: ${request.itemId}`,
      });
    }

    const steps = stepsOf(item.spec);
    const countsTowardMastery = this.countsTowardMastery(steps, request.itemId, request.stepId);

    // 选项下标越界是**调用方传错**（422），不是「答错了」。区分这两件事很重要：
    // 越界当成答错会往证据里塞一条假的「他这道题不会」。
    const expected = item.answer;
    if (typeof expected === 'number') {
      const total = optionCount(item.options);
      if (typeof request.answer === 'number' && request.answer >= total) {
        throw new UnprocessableEntityException({
          code: 'VALIDATION_FAILED',
          message: `选项下标 ${request.answer} 超出这道题的选项个数 ${total}`,
        });
      }
    }

    const judgement = judgeAnswer(expected, request.answer);
    if (judgement.verdict === 'invalid') {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: judgement.reason,
      });
    }
    const correct = judgement.verdict === 'correct';
    const knowledgeKind = kindOfItem(item.spec, request.itemId) ?? 'concept';

    const client = await this.db.connection.connect();
    try {
      await client.query('BEGIN');

      // 同一道题的并发作答会算出同一个 attempt_no。用事务级咨询锁按题目串行化：
      // 不用 `SELECT ... FOR UPDATE` 是因为「第一行还不存在」时它锁不住任何行，
      // 两个并发请求会各拿到 1 —— 而这恰好是最常见的场景（第一次作答后立刻重试）。
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `attempt:${item.micro_kp_id}:${request.itemId}`,
      ]);

      const run: Runner = async (sql, params) => {
        const result = await client.query(sql, params as unknown[]);
        return result.rows as Record<string, unknown>[];
      };

      const inserted = await run(
        `INSERT INTO attempts
           (micro_kp_id, item_id, level_id, variant_group, correct, answer,
            latency_ms, hints_used, attempt_no, counts_toward_mastery, knowledge_kind)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8,
                 (SELECT COALESCE(MAX(attempt_no), 0) + 1
                    FROM attempts
                   WHERE micro_kp_id = $1 AND item_id = $2),
                 $9, $10)
         RETURNING id::text AS id, micro_kp_id, item_id, level_id, variant_group,
                   correct, attempt_no, counts_toward_mastery, knowledge_kind, created_at`,
        [
          item.micro_kp_id,
          request.itemId,
          item.level_id,
          item.variant_group,
          correct,
          JSON.stringify(request.answer),
          request.latencyMs ?? null,
          request.hintsUsed ?? null,
          countsTowardMastery,
          knowledgeKind,
        ],
      );

      const row = inserted[0] as unknown as AttemptRow;
      const answeredAt = row.created_at.toISOString();

      // 掌握度只挂在叶节点上（ADR-0004）。父节点的数是只读派生，写它就是
      // 明令禁止的事 —— 所以这道闸不是「顺手加的」，是那条裁定的落点。
      const leafRows = await run(`SELECT is_leaf FROM knowledge_points WHERE id = $1`, [
        item.micro_kp_id,
      ]);
      const isLeaf = leafRows[0]?.['is_leaf'] === true;

      let mastery;
      if (isLeaf) {
        // 回放用「这次作答的时刻」而不是「现在」：同一响应里的百分比与
        // 那条 attempt 属于同一瞬间，且算法里再没有任何一处需要读时钟。
        const snapshot = await this.replay(run, item.micro_kp_id, answeredAt);
        await upsertMastery(
          run,
          item.micro_kp_id,
          {
            achieved: snapshot.achieved,
            current: snapshot.current,
            state: snapshot.state,
            attemptCount: snapshot.attemptCount,
            variantCount: snapshot.variantCount,
            evidenceSufficient: snapshot.evidenceSufficient,
          },
          answeredAt,
        );
        mastery = this.mastery.toView(
          item.micro_kp_id,
          await this.nameOf(run, item.micro_kp_id),
          true,
          0,
          snapshot,
        );
      } else {
        // 非叶节点（配置错误的关卡指向了折叠节点）：作答照样落库，但掌握度
        // 只能走聚合读路径。这里**不写** mastery 行。
        mastery = await this.mastery.view(item.micro_kp_id, answeredAt);
      }

      await client.query('COMMIT');

      return {
        attempt: this.toRecord(row),
        mastery,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** 在事务内重放一个知识点的证据。 */
  private async replay(run: Runner, microKpId: string, evaluatedAt: string) {
    const rows = await loadEvidence(run, [microKpId]);
    return snapshotOf(groupByMicroKp(rows).get(microKpId) ?? [], evaluatedAt);
  }

  private async nameOf(run: Runner, microKpId: string): Promise<string> {
    const rows = await run(`SELECT name FROM knowledge_points WHERE id = $1`, [microKpId]);
    return String(rows[0]?.['name'] ?? microKpId);
  }

  /**
   * 这次作答算不算掌握度证据。
   *
   * - 显式给了 `stepId`：必须真的是该关卡里引用了这道题的那一段，否则 422。
   *   放行的话，客户端可以对深究段的题谎报 `stepId: 's-quiz'` 把补救练习
   *   刷成掌握度证据。
   * - 没给：看这道题被哪些段引用。只要**有任何一段**不是补救段就计分
   *   （保守：宁可少算也不要把深究段算成惩罚；但也不要把好好的判定题漏掉）。
   */
  private countsTowardMastery(
    steps: readonly StepRow[],
    itemId: string,
    stepId: string | undefined,
  ): boolean {
    const referencing = steps.filter((step) => step.itemIds.includes(itemId));

    if (stepId !== undefined) {
      const step = referencing.find((candidate) => candidate.id === stepId);
      if (!step) {
        throw new UnprocessableEntityException({
          code: 'VALIDATION_FAILED',
          message: `步骤 ${stepId} 不引用题目 ${itemId}，无法据此判断这次作答属于哪一段`,
        });
      }
      return !REMEDIATION_STEPS.has(step.kind);
    }

    if (referencing.length === 0) return true;
    return referencing.some((step) => !REMEDIATION_STEPS.has(step.kind));
  }

  private toRecord(row: AttemptRow): AttemptRecord {
    return {
      attemptId: row.id,
      itemId: row.item_id,
      // 历史行的 level_id 可能为空（0011 之前的作答，或关卡被删后 SET NULL）
      levelId: row.level_id,
      microKpId: row.micro_kp_id,
      variantGroup: row.variant_group,
      correct: row.correct,
      attemptNo: row.attempt_no,
      countsTowardMastery: row.counts_toward_mastery,
      knowledgeKind:
        row.knowledge_kind === 'fact' ||
        row.knowledge_kind === 'concept' ||
        row.knowledge_kind === 'comprehensive'
          ? row.knowledge_kind
          : 'concept',
      createdAt: row.created_at.toISOString(),
    };
  }
}
