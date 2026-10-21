/**
 * 阻塞项描述的测试。
 *
 * 这里锁的是一个**真发生过的事故**：`topBlockers[].description` 直接取
 * `stage.result.detail.slice(0, 200)`，遇到一条只有 8 个字的 detail
 *（「读取推荐列表失败」），`ReportSchema.parse` 抛 ZodError，整份报告没落盘 ——
 * 三档跑了十分钟，证据全丢。
 *
 * 所以这些用例的重点不是「格式对不对」，而是**任何失败都能生成一条
 * 过得了 schema、且能据以行动的描述**。
 */

import { describe, expect, it } from 'vitest';
import { buildTopBlockers, describeBlocker, MIN_DESCRIPTION_CHARS } from '../src/report/blockers.ts';
import { ReportSchema } from '../src/report/schema.ts';
import type { StageRecord } from '../src/layer2/stages.ts';

function stage(overrides: Partial<StageRecord> = {}): StageRecord {
  return {
    stage: 'map',
    label: 'S3 知识图谱',
    url: 'http://localhost:5173/map',
    startedAt: '2026-10-21T04:00:00.000Z',
    durationMs: 1000,
    result: { status: 'passed', detail: '清单 400 个节点' },
    evidence: [],
    screenshot: null,
    consoleErrors: [],
    ...overrides,
  };
}

describe('阻塞项描述', () => {
  it('detail 只有 8 个字时也能生成过 schema 的描述（事故回归）', () => {
    /* 这就是那次真跑出事的形状：detail「读取推荐列表失败」= 8 字，
       低于 schema 的 min(10)。 */
    const broken = stage({
      result: { status: 'backend_error', httpStatus: 0, responseBody: '', detail: '读取推荐列表失败' },
    });
    const description = describeBlocker(broken);
    expect(description.length).toBeGreaterThanOrEqual(MIN_DESCRIPTION_CHARS);
    /* 补进去的必须是事实，不是「加载失败请重试」这类空话。 */
    expect(description).toContain('后端不可达');
    expect(description).toContain('读取推荐列表失败');
  });

  it('detail 为空字符串时仍然能过关，且诚实说明没有细节', () => {
    const empty = stage({ result: { status: 'locator_failure', selector: '', detail: '' } });
    const description = describeBlocker(empty);
    expect(description.length).toBeGreaterThanOrEqual(MIN_DESCRIPTION_CHARS);
    expect(description).toContain('未采集到细节');
  });

  it('HTTP 状态 0 写成「后端不可达」，不写成 HTTP 0', () => {
    /* 0 不是状态码，是 fetch 根本没连上。写成 HTTP 0 会让人去查一个
       不存在的状态码。 */
    const down = stage({ result: { status: 'backend_error', httpStatus: 0, responseBody: '', detail: '取图谱失败' } });
    expect(describeBlocker(down)).not.toContain('HTTP 0');
    expect(describeBlocker(down)).toContain('后端不可达');
  });

  it('真状态码照原样写出来', () => {
    const e502 = stage({ result: { status: 'backend_error', httpStatus: 502, responseBody: 'Bad Gateway', detail: '取推荐失败' } });
    expect(describeBlocker(e502)).toContain('HTTP 502');
  });

  it('数字对不上时把两边值都写进描述', () => {
    const mismatch = stage({
      result: { status: 'assertion_mismatch', expected: '3 条', actual: '0 条', detail: '推荐标记数不一致' },
    });
    const description = describeBlocker(mismatch);
    expect(description).toContain('期望 3 条');
    expect(description).toContain('实际 0 条');
  });

  it('找不到元素时带上选择器，否则读报告的人还得去翻 journey JSON', () => {
    const locator = stage({
      result: { status: 'locator_failure', selector: 'role=button[name="开始"]', detail: '没找到开始按钮' },
    });
    expect(describeBlocker(locator)).toContain('role=button[name="开始"]');
  });

  it('证据只取前两条，不把整段证据塞进描述', () => {
    const noisy = stage({
      result: { status: 'assertion_mismatch', expected: '1', actual: '2', detail: '数字对不上' },
      evidence: ['证据一', '证据二', '证据三', '证据四'],
    });
    const description = describeBlocker(noisy);
    expect(description).toContain('证据一');
    expect(description).toContain('证据二');
    expect(description).not.toContain('证据三');
  });
});

describe('buildTopBlockers', () => {
  it('每档只取第一处失败，最多三条', () => {
    const run = (stages: StageRecord[]) => ({ journey: { stages } });
    const failures = [
      stage({ stage: 'map', label: 'S3 知识图谱', result: { status: 'locator_failure', selector: '#x', detail: '第一处失败' } }),
      stage({ stage: 'answer', label: 'S4 作答与判分', result: { status: 'backend_error', httpStatus: 500, responseBody: '', detail: '第二处失败' } }),
    ];
    const blockers = buildTopBlockers([run(failures), run(failures), run(failures), run(failures)], () => 'S3');
    expect(blockers).toHaveLength(3);
    for (const blocker of blockers) expect(blocker.description).toContain('第一处失败');
  });

  it('全绿的旅程产出空数组，不是 null', () => {
    expect(buildTopBlockers([{ journey: { stages: [stage()] } }], () => 'S3')).toEqual([]);
  });

  it('产出的每一条都能过 ReportSchema 的 topBlockers 校验', () => {
    /* 端到端锁一次：描述生成器与 schema 是两份手写的约束，
       只测其中一边都可能漏。 */
    const blockers = buildTopBlockers(
      [{ journey: { stages: [stage({ result: { status: 'backend_error', httpStatus: 0, responseBody: '', detail: '挂了' } })] } }],
      () => 'S3',
    );
    const parsed = ReportSchema.shape.topBlockers.safeParse(blockers);
    expect(parsed.success).toBe(true);
  });
});
