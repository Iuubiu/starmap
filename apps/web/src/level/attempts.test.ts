/**
 * 作答记账日志的纯函数测试（票 05）。
 *
 * ## 为什么这些看起来「只是几个 setState」的东西值得单独测
 *
 * 三条转移规则各对应一个会静默出错的事故：
 *
 * 1. `markPending` 不覆盖已 `recorded` 的题 —— 覆盖了就等于把「已入库」退回
 *    「在路上」，页面上的「已记入学习档案（第 7 次）」会凭空消失。
 * 2. `markRecorded` 不覆盖已 `recorded` 的题 —— 题库里 `attempt_no` 会因此
 *    显示成第二次，而库里只有一行。
 * 3. `markFailed` **要**覆盖（含已 `recorded`）：唯一会走到这里的场景是
 *    「同一题被提交了两次而第二次失败」，此时让学习者看到「没记上」比让他
 *    相信两条都记上了安全 —— 掌握度的账宁可少记也不能多记。
 *
 * 用点击去测这三条要渲染整个播放页、还要伪造时序；纯函数五秒钟测完。
 */
import { describe, expect, it } from 'vitest';
import type { AttemptRecord } from '../api/queries';
import {
  createSubmissionLog,
  failedCount,
  markFailed,
  markPending,
  markRecorded,
  recordedCount,
  statusOf,
} from './attempts';

const record = (itemId: string, attemptNo = 1): AttemptRecord => ({
  attemptId: String(attemptNo),
  attemptNo,
  itemId,
  microKpId: 'kp-bool',
  levelId: 'lv-bool-laws',
  variantGroup: 'vg-absorb',
  knowledgeKind: 'concept',
  correct: true,
  countsTowardMastery: true,
  createdAt: '2026-10-20T00:00:00.000Z',
  reviewRoundId: null,
});

describe('作答记账日志', () => {
  it('空日志里什么都查不到，两个计数都是 0', () => {
    const log = createSubmissionLog();
    expect(statusOf(log, 'i-a')).toBeUndefined();
    expect(recordedCount(log)).toBe(0);
    expect(failedCount(log)).toBe(0);
  });

  it('提交后进入待定态，且不伪造一条记录', () => {
    const log = markPending(createSubmissionLog(), 'i-a');
    expect(statusOf(log, 'i-a')).toEqual({ kind: 'pending' });
    // 待定 ≠ 已记上。后者要等真实回执，否则「点了按钮」就成了掌握度的依据。
    expect(recordedCount(log)).toBe(0);
  });

  it('回执到了转成已记录，并带上后端返回的 attemptNo', () => {
    const log = markRecorded(markPending(createSubmissionLog(), 'i-a'), record('i-a', 7));
    expect(statusOf(log, 'i-a')).toMatchObject({ kind: 'recorded' });
    expect(statusOf(log, 'i-a')).toEqual({ kind: 'recorded', record: record('i-a', 7) });
    expect(recordedCount(log)).toBe(1);
  });

  it('已记录的题不会被重复的 pending 覆盖 —— 否则「已入库」会退回「在路上」', () => {
    const recorded = markRecorded(createSubmissionLog(), record('i-a', 7));
    const again = markPending(recorded, 'i-a');
    // 返回同一个引用：没有状态变化就不该触发一次无谓的重渲染
    expect(again).toBe(recorded);
    expect(statusOf(again, 'i-a')).toMatchObject({ kind: 'recorded' });
  });

  it('已记录的题不会被第二条回执覆盖 —— 库里只有一行，界面也只该显示那一行的号', () => {
    const recorded = markRecorded(createSubmissionLog(), record('i-a', 7));
    const again = markRecorded(recorded, record('i-a', 8));
    expect(again).toBe(recorded);
    expect(statusOf(again, 'i-a')).toEqual({ kind: 'recorded', record: record('i-a', 7) });
  });

  it('失败留下原因，并计入失败数（页面据此提示掌握度这次不会更新）', () => {
    const log = markFailed(markPending(createSubmissionLog(), 'i-a'), 'i-a', '网络断了');
    expect(statusOf(log, 'i-a')).toEqual({ kind: 'failed', message: '网络断了' });
    expect(failedCount(log)).toBe(1);
    expect(recordedCount(log)).toBe(0);
  });

  it('失败会盖掉已记录态：宁可说「没记上」，也不让学习者以为两条都记上了', () => {
    const recorded = markRecorded(createSubmissionLog(), record('i-a', 7));
    const failed = markFailed(recorded, 'i-a', '响应丢了');
    expect(statusOf(failed, 'i-a')).toEqual({ kind: 'failed', message: '响应丢了' });
    expect(recordedCount(failed)).toBe(0);
    expect(failedCount(failed)).toBe(1);
  });

  it('多道题各记各的，互不影响（这是「一张关卡多道题」的常态）', () => {
    let log = createSubmissionLog();
    log = markPending(log, 'i-a');
    log = markPending(log, 'i-b');
    log = markRecorded(log, record('i-a', 1));
    log = markFailed(log, 'i-b', '超时');

    expect(recordedCount(log)).toBe(1);
    expect(failedCount(log)).toBe(1);
    expect(statusOf(log, 'i-a')).toMatchObject({ kind: 'recorded' });
    expect(statusOf(log, 'i-b')).toEqual({ kind: 'failed', message: '超时' });
  });

  it('纯函数不改入参：旧日志对象在调用后仍然保持原样', () => {
    const before = createSubmissionLog();
    const after = markPending(before, 'i-a');
    // 传入的是空对象，若实现里原地 mutate，这条会红
    expect(before).toEqual({});
    expect(after).not.toBe(before);
  });
});
