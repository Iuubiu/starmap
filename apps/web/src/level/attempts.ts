/**
 * 作答记账的**前端状态**：哪些题已经送去后端、哪些还在路上、哪些没记上。
 *
 * ## 为什么需要它
 *
 * 票 05 把「作答」从纯前端事件变成了要落库的证据。但落库是异步的，而反馈必须
 * 立即出现（票 04 验收 3）—— 于是同一时刻会有两份关于「这道题作答了没」的事实：
 * `flow.choices`（本地，已作答）与后端的 `app.attempts`（已记账）。两者在失败时
 * 会分叉，这个模块就是分叉的可视记录。
 *
 * ## 为什么不做乐观更新
 *
 * 不能拿「点了提交」当成「证据已入库」。掌握度是这次学习记录里唯一的事后依据，
 * 它的来源必须是一个真实的 201/200，而不是一个被假定成功的按钮点击。所以这里
 * 只有三态：`pending` / `recorded` / `failed`，没有「大概存上了」。
 *
 * ## 为什么把纯函数单独放
 *
 * 这三条状态转移（提交→待定、成功→已记、失败→留痕）是可以在没有 DOM 的情况下
 * 断言的行为；写进组件就只能靠点击去测「连点两次会不会重复计数」这类不变量。
 */
import type { AttemptRecord } from '../api/queries';

/** 一道题的记账状态。答案本身的正确与否**不在这里** —— 那是 `flow.records` 的事。 */
export type SubmissionStatus =
  | { kind: 'pending' }
  | { kind: 'recorded'; record: AttemptRecord }
  | { kind: 'failed'; message: string };

/** 整页的记账日志：itemId → 状态。没键 = 还没提交过。 */
export type SubmissionLog = Readonly<Record<string, SubmissionStatus>>;

export function createSubmissionLog(): SubmissionLog {
  return {};
}

/** 已送出、等回执。重复调用返回同一个值（同一题不会被送两次，见下）。 */
export function markPending(log: SubmissionLog, itemId: string): SubmissionLog {
  if (log[itemId]?.kind === 'pending' || log[itemId]?.kind === 'recorded') return log;
  return { ...log, [itemId]: { kind: 'pending' } };
}

/**
 * 后端确认已落库。
 *
 * 已 `recorded` 的题**不覆盖**：同一张关卡里一道题只能答一次（`flow` 已锁），
 * 所以第二次收到 success 只可能是重复回调。让先到的那条留着，等于让日志
 * 与库里那一行保持同一份 `attempt_no`。
 */
export function markRecorded(log: SubmissionLog, record: AttemptRecord): SubmissionLog {
  if (log[record.itemId]?.kind === 'recorded') return log;
  return { ...log, [record.itemId]: { kind: 'recorded', record } };
}

export function markFailed(log: SubmissionLog, itemId: string, message: string): SubmissionLog {
  return { ...log, [itemId]: { kind: 'failed', message } };
}

/** 特定题的记账状态；`undefined` = 没提交过。 */
export function statusOf(log: SubmissionLog, itemId: string): SubmissionStatus | undefined {
  return log[itemId];
}

/** 有多少条作答真的落库了。小结页用它区分「本地答了几道」与「记上了几道」。 */
export function recordedCount(log: SubmissionLog): number {
  return Object.values(log).filter((entry) => entry.kind === 'recorded').length;
}

/** 有多少条没记上。>0 时页面要提示「掌握度这次没更新」，而不是假装成功。 */
export function failedCount(log: SubmissionLog): number {
  return Object.values(log).filter((entry) => entry.kind === 'failed').length;
}
