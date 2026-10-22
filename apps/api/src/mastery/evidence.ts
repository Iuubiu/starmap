/**
 * 作答行 → 证据事件 → 双字段快照。
 *
 * 这一层只有纯函数，没有数据库访问：读侧（`MasteryService`）与写侧
 * （`AttemptsService` 在事务里重算）都调用它，两边算出的必须是同一串数。
 * 把「怎么把行变成事件」写两遍是这类系统最容易出现的漂移 —— 写侧用了
 * `knowledge_kind`，读侧忘了过滤 `counts_toward_mastery`，于是同一个知识点
 * 在「刚答完」和「刷新页面」时显示两个百分比。
 */
import {
  DEFAULT_BKT,
  MASTERY_MIN_ATTEMPTS,
  MASTERY_MIN_VARIANTS,
  replayMastery,
  type BktParams,
  type EvidenceEvent,
  type KnowledgeKind,
  type MasterySnapshot,
} from '@starmap/engine';

/** `app.attempts` 里回放需要的那几列。pg 把 timestamptz 解析成 Date。 */
export type EvidenceRow = {
  micro_kp_id: string;
  item_id: string;
  variant_group: string;
  correct: boolean;
  created_at: Date;
  knowledge_kind: string | null;
};

const KNOWLEDGE_KINDS = new Set<string>(['fact', 'concept', 'comprehensive']);

/**
 * 历史行没有 `knowledge_kind`（0011 迁移之前写下的证据）。
 *
 * 回落成 `concept`（30 天）而不是「跳过这行」或「按占比猜」：
 * - 跳过会让老学习记录的作数凭空减少，掌握度可能从「已掌握」掉回「刚接触」；
 * - 按占比猜需要先知道其它行的类型，而这里只有一行，逻辑会变成「取决于
 *   这一行在数组里的位置」。
 *
 * `concept` 是 `replayMastery` 在无证据时自己用的默认半衰期，两边一致；
 * 而且「多半是概念题」是这个学习站里最不容易错得离谱的假设。
 */
function kindOf(value: string | null): KnowledgeKind {
  return value !== null && KNOWLEDGE_KINDS.has(value) ? (value as KnowledgeKind) : 'concept';
}

/** 把一组行按 micro_kp_id 分组。已按 `created_at, id` 升序取回。 */
export function groupByMicroKp(rows: readonly EvidenceRow[]): Map<string, EvidenceEvent[]> {
  const grouped = new Map<string, EvidenceEvent[]>();
  for (const row of rows) {
    const event: EvidenceEvent = {
      itemId: row.item_id,
      variantGroup: row.variant_group,
      kind: kindOf(row.knowledge_kind),
      correct: row.correct,
      // ISO 字符串而不是 Date：回放层只认字符串，且这样测试里手写事件不用造 Date
      at: row.created_at.toISOString(),
    };
    const list = grouped.get(row.micro_kp_id);
    if (list) list.push(event);
    else grouped.set(row.micro_kp_id, [event]);
  }
  return grouped;
}

/**
 * 回放一组事件。
 *
 * `evaluatedAt` 必须由调用方显式给出 —— 这是票 05 验收第 7 条（无当前时间
 * 泄漏）的落点：函数内部不读 `Date.now()`，所以同一串事件 + 同一时刻永远
 * 得出同一串数，测试才能断言具体值而不是「大概这么多」。
 */
export function snapshotOf(
  events: readonly EvidenceEvent[],
  evaluatedAt: string,
  params: BktParams = DEFAULT_BKT,
): MasterySnapshot {
  return replayMastery(events, evaluatedAt, params);
}

/**
 * 聚合多个叶子快照，给折叠父节点用（ADR-0004：只读派生、不落库）。
 *
 * 权重是**作答次数**而不是「变式数」或「1」：做过 20 次的孩子和一个只碰过
 * 1 次的孩子对父节点颜色的贡献不该相同，否则父节点色会随「哪些孩子被点开过」
 * 剧烈跳动。
 *
 * 没有任何证据时返回 null，由调用方渲染成「未学习」，而不是 0%。
 */
export function aggregateSnapshots(
  snapshots: readonly MasterySnapshot[],
): { current: number | null; achieved: number | null; attemptCount: number; variantCount: number; evidenceSufficient: boolean } {
  let weightedCurrent = 0;
  let weightedAchieved = 0;
  let weight = 0;
  let attemptCount = 0;
  let variantCount = 0;

  for (const snapshot of snapshots) {
    attemptCount += snapshot.attemptCount;
    variantCount += snapshot.variantCount;
    if (snapshot.attemptCount === 0) continue;
    weightedCurrent += snapshot.current * snapshot.attemptCount;
    weightedAchieved += snapshot.achieved * snapshot.attemptCount;
    weight += snapshot.attemptCount;
  }

  // 门槛对聚合值同样成立：一个 20 个叶子的章节只有 3 次作答时，「这一章
  // 学会了多少」这个问题没有答案，给数字只是把「不知道」包装成结论。
  const evidenceSufficient =
    attemptCount >= MASTERY_MIN_ATTEMPTS && variantCount >= MASTERY_MIN_VARIANTS;

  return {
    current: weight === 0 ? null : weightedCurrent / weight,
    achieved: weight === 0 ? null : weightedAchieved / weight,
    attemptCount,
    variantCount,
    evidenceSufficient,
  };
}
