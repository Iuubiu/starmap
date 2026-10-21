/**
 * 评估器里**唯一**允许碰数据库的地方，而且只有一条写操作。
 *
 * ## 为什么黑盒评估器要开这个口子
 *
 * 票 20 的 AC3 要求「触发一次复验」。复验的触发条件是 `app.mastery.next_review_at`
 * 到期，而真实库里所有已掌握知识点的排期都在**明天**（票 07 的规则：掌握那一刻
 * 起算 +1 天）。产品侧没有任何接口能改这个时刻 —— 那是对的，让学生能改复验
 * 排期就等于让复验失效。
 *
 * 所以「制造一次到期」只能从评估器这边做。这是评估器**唯一**的写库操作，写成
 * 一个只接受 `microKpId` 的函数，SQL 里没有 DELETE、没有 INSERT、没有 DDL。
 *
 * ## 为什么用 psql 子进程而不是 pg 驱动
 *
 * `tools/eval` 的依赖里没有 `pg`，加一个驱动只为跑一条 UPDATE 不划算；
 * 而且 psql 在开发机上是既有的（`apps/api` 的迁移脚本也靠它）。代价是
 * 要处理「psql 不在 PATH 上」——见 `resolvePsql()`。
 *
 * ## 读也要走这里
 *
 * `review_stage` 与 `next_review_at` 没有任何接口暴露（`/mastery/:id` 只给
 * 掌握度双字段）。阶段要报 before/after 真值，只能读库。读操作一律只 SELECT。
 *
 * ## 表名必须写全限定名 `app.xxx`
 *
 * psql 子进程的会话 `search_path` 是默认的 `"$user", public`，**不是** `app, public`
 * —— 那是 `apps/api/src/db/database.service.ts` 的连接池自己设的，psql 不继承。
 * 所以漏写前缀的表名会直接 `relation "xxx" does not exist`，而这类错误在
 * `pickMasteredKp()` 里被吞成 `null`，表现成「本机没有已掌握的知识点」。
 * 实跑踩过这个坑（复验阶段一直说未覆盖），因此有 `test/sql-schema.test.ts`
 * 静态扫描本文件的每一条 FROM/JOIN。
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** 与 `apps/api/src/db/database.service.ts` 的默认值一致。 */
const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:5432/starmap';

/** Windows 上 scoop 装的 psql 常见落点。PATH 里没有时按这个顺序找。 */
const PSQL_FALLBACKS = [
  'C:/Users/Yhwhy/scoop/apps/postgresql/current/bin/psql.exe',
  'C:/Program Files/PostgreSQL/18/bin/psql.exe',
  'C:/Program Files/PostgreSQL/17/bin/psql.exe',
];

/**
 * 找 psql 可执行文件。
 *
 * 先试 `psql --version`（PATH 命中时最常见），失败再逐个试已知路径。
 * 全都找不到就返回 null —— 调用方据此把阶段记成 `skipped`，而不是让整条
 * 旅程崩掉：一台没装 psql 的机器仍然能跑完其余九个阶段。
 */
export function resolvePsql(): string | null {
  const explicit = process.env['PSQL_BIN'];
  if (explicit !== undefined && explicit !== '' && existsSync(explicit)) return explicit;

  const probe = spawnSync('psql', ['--version'], { encoding: 'utf8', shell: false });
  if (probe.status === 0) return 'psql';

  for (const candidate of PSQL_FALLBACKS) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export interface SqlResult {
  ok: boolean;
  /** 每行一个以 `|` 分隔的字符串（`-A -F'|'` 的格式）。 */
  rows: string[];
  /** psql 的原始错误输出（失败时）。 */
  error: string | null;
}

/** 跑一条 SQL。**不抛异常** —— 状态码是调用方的断言对象。 */
export function runSql(sql: string, options: { timeoutMs?: number } = {}): SqlResult {
  const psql = resolvePsql();
  if (psql === null) {
    return { ok: false, rows: [], error: '找不到 psql（PATH 与已知路径都没有），无法读写数据库' };
  }
  const connectionString = process.env['DATABASE_URL'] ?? DEFAULT_DATABASE_URL;
  const result = spawnSync(
    psql,
    [connectionString, '-v', 'ON_ERROR_STOP=1', '-A', '-F', '|', '-t', '-c', sql],
    { encoding: 'utf8', timeout: options.timeoutMs ?? 15_000, shell: false },
  );
  if (result.error !== undefined && result.error !== null) {
    return { ok: false, rows: [], error: result.error.message };
  }
  if (result.status !== 0) {
    return { ok: false, rows: [], error: (result.stderr ?? '').trim().slice(0, 800) };
  }
  const rows = (result.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return { ok: true, rows, error: null };
}

/** 知识点的 id 只可能是这些字符（来自 `content/` 的 slug）。用它挡 SQL 注入。 */
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

export function assertSafeMicroKpId(microKpId: string): boolean {
  return SAFE_ID.test(microKpId) && microKpId.length <= 200;
}

/**
 * 把一个已掌握知识点的复验排期拨到过去，制造一次「到期」。
 *
 * **这是本文件唯一的写操作。** 只改 `next_review_at`，不动 `review_stage`
 * （档位是「上一次复验过没过」的结果，与「现在到不到期」无关），不动任何
 * 掌握度字段，不删任何行。
 *
 * 返回受影响行数：0 表示这个知识点还没有 `mastery` 行（没掌握），调用方
 * 应当把它当成「本机没有可复验的已掌握知识点」而不是失败。
 */
export function makeReviewDue(microKpId: string, daysAgo = 1): { ok: boolean; affected: number; error: string | null } {
  if (!assertSafeMicroKpId(microKpId)) {
    return { ok: false, affected: 0, error: `知识点 id 含不安全字符，拒绝拼进 SQL：${microKpId}` };
  }
  const result = runSql(
    `UPDATE app.mastery
        SET next_review_at = now() - interval '${Math.max(1, Math.trunc(daysAgo))} day'
      WHERE micro_kp_id = '${microKpId}'
      RETURNING micro_kp_id`,
  );
  if (!result.ok) return { ok: false, affected: 0, error: result.error };
  return { ok: true, affected: result.rows.length, error: null };
}

export interface ReviewScheduleRow {
  microKpId: string;
  reviewStage: number;
  nextReviewAt: string | null;
  state: string;
}

/** 读一个知识点的复验排期真值。读不到返回 null。 */
export function readReviewSchedule(microKpId: string): ReviewScheduleRow | null {
  if (!assertSafeMicroKpId(microKpId)) return null;
  const result = runSql(
    `SELECT micro_kp_id, review_stage, COALESCE(to_char(next_review_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), ''), state
       FROM app.mastery WHERE micro_kp_id = '${microKpId}'`,
  );
  const row = result.rows[0];
  if (!result.ok || row === undefined) return null;
  const [id, stage, due, state] = row.split('|');
  if (id === undefined || stage === undefined || due === undefined || state === undefined) return null;
  return {
    microKpId: id,
    reviewStage: Number(stage),
    nextReviewAt: due === '' ? null : due,
    state,
  };
}

export interface ReviewRoundRow {
  id: string;
  verdict: string | null;
  itemCount: number;
  correctCount: number | null;
}

/** 读一轮复验在库里的终态。**用来断言「从 open 变 completed」**。 */
export function readReviewRound(roundId: string): ReviewRoundRow | null {
  if (!assertSafeMicroKpId(roundId)) return null;
  const result = runSql(
    `SELECT id, COALESCE(verdict, ''), item_count, COALESCE(correct_count::text, '')
       FROM app.review_rounds WHERE id = '${roundId}'`,
  );
  const row = result.rows[0];
  if (!result.ok || row === undefined) return null;
  const [id, verdict, itemCount, correctCount] = row.split('|');
  if (id === undefined || verdict === undefined || itemCount === undefined || correctCount === undefined) return null;
  return {
    id,
    verdict: verdict === '' ? null : verdict,
    itemCount: Number(itemCount),
    correctCount: correctCount === '' ? null : Number(correctCount),
  };
}

/**
 * 找出本机上「已掌握、且有可复验题目」的知识点。
 *
 * 优先选关卡题目多的那个 —— 3–5 题的下限要求至少 3 道 quiz/practice 题，
 * 题少的会被 `POST /review/rounds` 409 掉，白跑一轮。
 */
export function pickMasteredKp(): { microKpId: string; itemCount: number } | null {
  const result = runSql(
    `SELECT m.micro_kp_id, count(li.id) AS item_count
       FROM app.mastery m
       JOIN app.knowledge_points k ON k.id = m.micro_kp_id AND k.is_leaf
       JOIN app.levels l ON l.micro_kp_id = m.micro_kp_id
       JOIN app.level_items li ON li.level_id = l.id
      WHERE m.state = 'mastered' AND m.evidence_sufficient = true
      GROUP BY m.micro_kp_id
      HAVING count(li.id) >= 3
      ORDER BY count(li.id) DESC, m.micro_kp_id ASC
      LIMIT 1`,
  );
  const row = result.rows[0];
  if (!result.ok || row === undefined) return null;
  const [microKpId, itemCount] = row.split('|');
  if (microKpId === undefined || itemCount === undefined) return null;
  return { microKpId, itemCount: Number(itemCount) };
}
