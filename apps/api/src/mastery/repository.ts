/**
 * 掌握度读写的 SQL 层。
 *
 * 每个函数都接收一个 `Runner` 而不是直接用 `DatabaseService`：写路径在事务里
 * 跑（要用同一个 `client` 才能让 `attempts` 与 `mastery` 同成同败），读路径
 * 走连接池。把「用哪条连接」做成参数，才不会有人为了图省事在事务中间偷偷
 * 用池再开一条连接 —— 那样的写会落在事务外面，回滚时留下半条证据。
 *
 * SQL 里**不写 `app.` 前缀**：schema 由连接的 `search_path` 决定（生产是
 * `app`，测试是 `app_test_*`）。写死前缀会让测试静默读到生产表。
 */
import type { EvidenceRow } from './evidence.js';

/** 一条 SQL 执行通道。事务里传 client 适配器，池里传 DatabaseService 适配器。 */
export type Runner = (
  sql: string,
  params?: readonly unknown[],
) => Promise<Record<string, unknown>[]>;

export type KnowledgePointRow = {
  id: string;
  name: string;
  is_leaf: boolean;
  parent_id: string | null;
};

export async function findKnowledgePoint(
  run: Runner,
  microKpId: string,
): Promise<KnowledgePointRow | undefined> {
  const rows = (await run(
    `SELECT id, name, is_leaf, parent_id
       FROM knowledge_points
      WHERE id = $1`,
    [microKpId],
  )) as KnowledgePointRow[];
  return rows[0];
}

/**
 * 取一个知识点（或一组知识点）参与掌握度回放的证据。
 *
 * 两个过滤条件都不能少：
 * - `counts_toward_mastery = true` —— 深究与进一步讲解段的作答**全程不扣
 *   掌握度**（spec 需求 17）。它们已经落库（用于回看与下一步讲解），但不进
 *   BKT。少了这个条件，「在深究段诚实暴露自己不会」会变成惩罚，学生会立刻
 *   学会装懂，那一段就废了。
 * - `ORDER BY created_at ASC, id ASC` —— 回放按时间折叠。同一时刻（同一事务
 *   里的批量导入）用 id 兜底，保证同一串数据无论取几次都折出同一个结果。
 */
export async function loadEvidence(
  run: Runner,
  microKpIds: readonly string[],
): Promise<EvidenceRow[]> {
  if (microKpIds.length === 0) return [];
  return (await run(
    `SELECT micro_kp_id, item_id, variant_group, correct, created_at, knowledge_kind
       FROM attempts
      WHERE micro_kp_id = ANY($1::text[])
        AND counts_toward_mastery = true
      ORDER BY created_at ASC, id ASC`,
    [microKpIds],
  )) as unknown as EvidenceRow[];
}

/**
 * 折叠父节点下的全部叶节点（ADR-0004：父节点颜色由叶子按证据量加权聚合，
 * **只读派生、不落库**）。
 *
 * 用 `UNION`（去重）而不是 `UNION ALL`：`parent_id` 是自引用，库层面没有
 * 约束禁止成环；`UNION ALL` 会在环上无限展开直到连接被杀，一个坏数据能
 * 把整个接口拖死。去重后环会自然收敛。
 */
export async function loadLeafDescendants(run: Runner, microKpId: string): Promise<string[]> {
  const rows = (await run(
    `WITH RECURSIVE tree AS (
       SELECT id, is_leaf FROM knowledge_points WHERE id = $1
       UNION
       SELECT k.id, k.is_leaf FROM knowledge_points k JOIN tree t ON k.parent_id = t.id
     )
     SELECT id FROM tree WHERE is_leaf = true ORDER BY id`,
    [microKpId],
  )) as { id: string }[];
  return rows.map((row) => row.id);
}

/**
 * 落库双字段掌握度。**只对叶节点调用**（非叶节点的数是只读派生，写入就是
 * ADR-0004 明令禁止的事）。
 *
 * `current` 会被写进表，但它随时间是**持续变小**的 —— 所以读路径不读这一列，
 * 而是按请求时刻从证据重算（见 `MasteryService.view`）。这一列存在的意义是
 * 「上次作答那一刻的当前值」，给出题/复习计划做批量统计时不必重放全部证据；
 * 任何要展示给学习者的数字都必须现算。
 */
export async function upsertMastery(
  run: Runner,
  microKpId: string,
  snapshot: { achieved: number; current: number; state: string; attemptCount: number; variantCount: number; evidenceSufficient: boolean },
  evaluatedAt: string,
): Promise<void> {
  await run(
    `INSERT INTO mastery
       (micro_kp_id, achieved, current, state, attempt_count, variant_count,
        evidence_sufficient, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (micro_kp_id) DO UPDATE SET
       achieved           = EXCLUDED.achieved,
       current            = EXCLUDED.current,
       state              = EXCLUDED.state,
       attempt_count      = EXCLUDED.attempt_count,
       variant_count      = EXCLUDED.variant_count,
       evidence_sufficient = EXCLUDED.evidence_sufficient,
       updated_at         = EXCLUDED.updated_at`,
    [
      microKpId,
      snapshot.achieved,
      snapshot.current,
      snapshot.state,
      snapshot.attemptCount,
      snapshot.variantCount,
      snapshot.evidenceSufficient,
      evaluatedAt,
    ],
  );
}

/**
 * 答案比对用的题目行。
 *
 * 刻意 join `levels` 拿 `spec`：题目的知识类型（事实/概念/综合，决定半衰期）
 * 只存在于 spec 里，`level_items` 没有这一列。回放时现查 spec 是不行的
 * （spec 可改），所以必须在**写证据的那一刻**把它解析出来、写进
 * `attempts.knowledge_kind`（0011 迁移加的那一列）。
 */
export type ItemRow = {
  item_id: string;
  level_id: string;
  micro_kp_id: string;
  variant_group: string;
  pool: string;
  answer: unknown;
  options: unknown;
  spec: unknown;
};

export async function findItem(run: Runner, itemId: string): Promise<ItemRow | undefined> {
  const rows = (await run(
    `SELECT li.id AS item_id,
            li.level_id,
            l.micro_kp_id,
            li.variant_group,
            li.pool,
            li.answer,
            li.options,
            l.spec
       FROM level_items li
       JOIN levels l ON l.id = li.level_id
      WHERE li.id = $1`,
    [itemId],
  )) as ItemRow[];
  return rows[0];
}
