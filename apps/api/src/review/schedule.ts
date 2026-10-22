import { initialReviewSchedule } from '@starmap/engine';
import type { Runner } from '../mastery/repository.js';
import { setReviewSchedule } from './repository.js';

/**
 * 知识点第一次被判定为「已掌握」时，落下第一次复验排期（1 天后）。
 *
 * ## 为什么起算点是「掌握那一刻」
 *
 * 排期要回答的是「这条记忆从什么时候开始算该复习了」。这个时刻是**掌握发生的
 * 时刻**，不是学习者想起来打开复验页的时刻。用后者会让「1 天后该复验」悄悄
 * 变成「1 天后你来了才开始计时」—— 一个三天没打开应用的人，他的知识点会
 * 一直显示「还有 1 天到期」。
 *
 * ## 为什么已排期时不覆盖
 *
 * 每次答对都重设成 +1 天，会让反复练习的节点永远不到期 —— 等于让勤奋练习
 * 静默取消了复验。只在**还没有排期**时落第一档；之后的每一次推进都由
 * `ReviewService.complete` 按「过没过」决定。
 *
 * ## 为什么读列而不是读返回值
 *
 * 调用方（`AttemptsService`）刚写过 `mastery` 行，那里没有 `next_review_at`。
 * 一次 `SELECT` 换一个确定的分支，比在内存里维护「这行是不是新建的」可靠 ——
 * 后者的答案取决于 upsert 走的是 INSERT 还是 UPDATE。
 */
export async function ensureInitialReviewSchedule(
  run: Runner,
  microKpId: string,
  masteredAt: string,
): Promise<{ stage: number; nextDueAt: string } | null> {
  const rows = await run(`SELECT next_review_at FROM mastery WHERE micro_kp_id = $1`, [microKpId]);
  const existing = rows[0]?.['next_review_at'];
  if (existing) return null;

  const schedule = initialReviewSchedule(masteredAt, 'mastered');
  if (!schedule) return null;

  await setReviewSchedule(run, microKpId, schedule);
  return schedule;
}
