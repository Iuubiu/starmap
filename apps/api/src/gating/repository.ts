/**
 * 门控（gate）的数据访问。
 *
 * 与 `mastery/repository.ts` 一样，所有函数都接受一个 `Runner`：事务里传 client
 * 适配器、纯读时传池适配器。SQL 里**不写 `app.` 前缀** —— schema 由连接的
 * `search_path` 决定，写死前缀会让测试静默读到生产表。
 */
import type { Runner } from '../mastery/repository.js';

/**
 * 一道门控挂在哪个知识点上。
 *
 * `levels` 只记了 `micro_kp_id`，同一知识点可以有多张关卡；门控判的是
 * **知识点**这一层的出口（「这个知识点学完了没有」），不是「这张关卡做完了
 * 没有」。所以同知识点的多张关卡共享同一道门。
 */
export type GateLevelRow = {
  id: string;
  micro_kp_id: string;
  title: string;
  kind: string;
  spec: unknown;
};

export async function findLevel(run: Runner, levelId: string): Promise<GateLevelRow | undefined> {
  const rows = (await run(
    `SELECT id, micro_kp_id, title, kind, spec
       FROM levels
      WHERE id = $1`,
    [levelId],
  )) as GateLevelRow[];
  return rows[0];
}

/**
 * 一次作答的证据行（门控视角）。
 *
 * 与掌握度不同：门控要**每道题的最近一次**作答，而不是全部历史。理由见
 * `attemptsInLevel` 的注释。
 */
export type GateAttemptRow = {
  item_id: string;
  correct: boolean;
  created_at: Date | string;
  attempt_no: number;
};

/**
 * 读本关卡范围内、可用于门控的作答。
 *
 * ## 只算计分作答
 *
 * `counts_toward_mastery = false` 的是深究/进一步讲解段的作答 —— 那两段
 * 「全程不扣掌握度」（spec 需求 17），也**不能拿来当门控成绩**：否则学习者
 * 在深究段随手试出来的对错会变成门控分数，而那一段本来就是为了让他放心
 * 试错。同一道题在深究段答错、在判定段答对，门控只该看见后者。
 *
 * ## 为什么按题取最近一次
 *
 * spec 需求 42 的出口测是「8 题里 ≥7 对」。若把同一道题的多次重答全算进去，
 * 一个学习者可以把一道题做到会为止，把分母刷满 —— 那测的就不是「这一章会
 * 不会」，而是「愿不愿意反复试」。所以每道题只取**最近一次**：重答是对
 * 同一道题的修正，不是新证据。题量（分母）也随之是「做过的不同题目数」。
 *
 * ## 为什么限定关卡
 *
 * 门控挂在一个知识点上，但知识点下的题目可能分散在多张关卡里。传 `levelId`
 * 时只算这张关卡里出现的题（出口测就是这张关卡自己的题）；不传时按知识点
 * 全量算。后者用于「知识点下面还没有出口测关卡」的早期内容。
 */
export async function attemptsForGate(
  run: Runner,
  microKpId: string,
  levelId: string | null,
  itemIds: readonly string[],
): Promise<GateAttemptRow[]> {
  if (itemIds.length === 0) return [];
  const rows = (await run(
    `SELECT DISTINCT ON (a.item_id)
            a.item_id, a.correct, a.created_at, a.attempt_no
       FROM attempts a
      WHERE a.micro_kp_id = $1
        AND a.counts_toward_mastery = true
        AND ($2::text IS NULL OR a.level_id = $2)
        AND a.item_id = ANY($3::text[])
      ORDER BY a.item_id, a.created_at DESC, a.id DESC`,
    [microKpId, levelId, itemIds],
  )) as GateAttemptRow[];
  // 按入参 itemIds 的顺序返回：判定结果里的 itemIds 要跟 spec 里的题干顺序一致，
  // 否则前端把错题列出来时顺序每次都在跳。
  const order = new Map(itemIds.map((id, index) => [id, index]));
  return rows.sort((a, b) => (order.get(a.item_id) ?? 0) - (order.get(b.item_id) ?? 0));
}

/**
 * 下游节点：`kp_edges` 里以 `microKpId` 为 from 的 `to_id`。
 *
 * 方向在 `tools/ingest/edges.py` 里定死了：`from_id` 是先修的、被引用的那个，
 * `to_id` 是后学的、引用它的那个。所以「学完 A 才能学 B」对应一条
 * `A --prereq--> B`，解锁 A 就是解锁这条边上的 B。
 */
export async function downstreamNodeIds(run: Runner, microKpId: string): Promise<string[]> {
  const rows = (await run(
    `SELECT DISTINCT to_id
       FROM kp_edges
      WHERE from_id = $1
        AND kind = 'prereq'
      ORDER BY to_id`,
    [microKpId],
  )) as { to_id: string }[];
  return rows.map((row) => row.to_id);
}

/**
 * 挡在一个节点前面的、**设了门控**的先修节点。
 *
 * 只认设了门控的先修边：spec 需求 17 说硬门槛只设在章末出口与高入度先修
 * 节点，其余先修关系是软提示（推荐排序用），挡住了会让学习者寸步难行。
 */
export type PrereqBlockerRow = {
  prerequisite_id: string;
  prerequisite_name: string;
  level_id: string | null;
  level_title: string | null;
  spec: unknown;
};

export async function gatedPrerequisites(
  run: Runner,
  microKpId: string,
): Promise<PrereqBlockerRow[]> {
  const rows = (await run(
    `SELECT e.from_id AS prerequisite_id,
            kp.name     AS prerequisite_name,
            l.id        AS level_id,
            l.title     AS level_title,
            l.spec
       FROM kp_edges e
       JOIN knowledge_points kp ON kp.id = e.from_id
       LEFT JOIN LATERAL (
         SELECT lv.id, lv.title, lv.spec
           FROM levels lv
          WHERE lv.micro_kp_id = e.from_id
          ORDER BY lv.ordinal, lv.id
          LIMIT 1
       ) l ON true
      WHERE e.to_id = $1
        AND e.kind = 'prereq'
      ORDER BY e.from_id`,
    [microKpId],
  )) as PrereqBlockerRow[];
  return rows;
}

/** 读已经开过的门（`node_id` 为该节点、`prerequisite_id` 为挡路方）。 */
export async function unlockedBy(
  run: Runner,
  nodeId: string,
  prerequisiteId: string,
): Promise<boolean> {
  const rows = (await run(
    `SELECT 1 AS hit FROM node_unlocks WHERE node_id = $1 AND prerequisite_id = $2`,
    [nodeId, prerequisiteId],
  )) as { hit: number }[];
  return rows.length > 0;
}

/**
 * 记下一条解锁。`ON CONFLICT DO NOTHING`：首次解锁的时刻是成长记录的一部分，
 * 第二次通过同一道门不该把它覆盖成今天。
 */
export async function recordUnlock(
  run: Runner,
  input: {
    nodeId: string;
    prerequisiteId: string;
    levelId: string | null;
    gateMode: 'exit' | 'prereq';
    correct: number;
    itemCount: number;
  },
): Promise<boolean> {
  const rows = (await run(
    `INSERT INTO node_unlocks
       (node_id, prerequisite_id, unlocked_by_level_id, gate_mode, correct_count, item_count)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (node_id, prerequisite_id) DO NOTHING
     RETURNING node_id`,
    [
      input.nodeId,
      input.prerequisiteId,
      input.levelId,
      input.gateMode,
      input.correct,
      input.itemCount,
    ],
  )) as { node_id: string }[];
  return rows.length > 0;
}

/**
 * 写一条学习日志。
 *
 * `session_id` 不给（本应用目前没有登录态，会话由前端持有），留 null；
 * `micro_kp_id` 记的是**门控挂在哪个知识点上**，这样 `log_kp_idx` 能直接
 * 按知识点倒序捞出「这个知识点考过几次门控」。
 */
export async function writeGateLog(
  run: Runner,
  input: { microKpId: string; event: string; payload: unknown },
): Promise<void> {
  await run(
    `INSERT INTO learning_log (session_id, micro_kp_id, event, payload)
     VALUES (NULL, $1, $2, $3::jsonb)`,
    [input.microKpId, input.event, JSON.stringify(input.payload)],
  );
}

/** 最近的若干条门控日志（新的在前）。
 *
 * `levelId` 给定时只取 payload 里记着该关卡的那些：`learning_log` 按知识点
 * 建了索引，但一个知识点可能有多张关卡（教学关、判定关、复验关），历史
 * 回看必须局限在**这张关卡**上，否则回看里会混进别人的题目 id。
 */
export type GateLogRow = {
  event: string;
  payload: unknown;
  created_at: Date | string;
};

export async function gateLogs(
  run: Runner,
  input: { microKpId: string; levelId?: string | null; limit?: number },
): Promise<GateLogRow[]> {
  const rows = (await run(
    `SELECT event, payload, created_at
       FROM learning_log
      WHERE micro_kp_id = $1
        AND event LIKE 'gate!_%' ESCAPE '!'
        AND ($2::text IS NULL OR payload->>'levelId' = $2)
      ORDER BY created_at DESC, id DESC
      LIMIT $3`,
    [input.microKpId, input.levelId ?? null, input.limit ?? 5],
  )) as GateLogRow[];
  return rows;
}

/** 知识点名字（400 报错文案要用）。 */
export async function knowledgePointName(run: Runner, microKpId: string): Promise<string | null> {
  const rows = (await run(`SELECT name FROM knowledge_points WHERE id = $1`, [microKpId])) as {
    name: string;
  }[];
  return rows[0]?.name ?? null;
}

/** 节点是否存在（解锁状态查询的 404 判据）。 */
export async function knowledgePointExists(run: Runner, microKpId: string): Promise<boolean> {
  const rows = (await run(`SELECT 1 AS hit FROM knowledge_points WHERE id = $1`, [microKpId])) as {
    hit: number;
  }[];
  return rows.length > 0;
}
