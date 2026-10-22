import { describe, expect, it } from 'vitest';
import { classifyThrown } from '../src/layer2/journey.ts';
import type { VerifyFailure, VerifyResult } from '../src/layer2/stages.ts';

/**
 * 三类失败的分开计数是整份报告的地基。
 *
 * 合并成「失败 5 条」等于把「按钮不存在」（产品真点不动）和「计数差 1」
 * （两边数据源不一致）当成同一件事 —— 它们指向完全不同的修法。
 * 这个文件用**真实的报错形状**（Playwright 超时消息的原文、我们自己约定的
 * `status: 0`）钉住分类，而不是随便造几个 Error。
 */

/**
 * 收窄 `VerifyResult`。
 *
 * `expect(result.status).toBe('locator_failure')` 对 TypeScript 不构成收窄 ——
 * 断言函数不改变控制流类型。所以断言「它是失败」之后还得显式收窄一次，
 * 否则 `result.selector` 在联合类型上不存在。写成函数而不是每处 `as`，
 * 是因为 `as` 会在断言被删掉时悄悄继续工作。
 */
function asFailure(result: VerifyResult): VerifyFailure {
  if (result.status === 'passed') throw new Error(`期望失败，实际是通过：${result.detail}`);
  return result;
}

describe('classifyThrown', () => {
  it('Playwright 超时 → locator_failure，且保留选择器线索', () => {
    /* 真实消息长这样：locator.click: Timeout 30000ms exceeded. ... waiting for locator('button') */
    const error = new Error("locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator('button')");
    error.name = 'TimeoutError';
    const failure = asFailure(classifyThrown(error));
    expect(failure.status).toBe('locator_failure');
    expect(failure.detail).toContain('超时');
    expect(failure.selector).toBeTruthy();
  });

  it('只有消息里带 Timeout 字样也能认出来（name 被换掉的场景）', () => {
    const failure = asFailure(classifyThrown(new Error('waiting for locator(".graph-canvas") to be visible')));
    expect(failure.status).toBe('locator_failure');
  });

  it('HTTP 状态码 → backend_error，并把状态码与响应体留下', () => {
    const failure = asFailure(classifyThrown(new Error('GET /api/v1/graph 返回 HTTP 502 Bad Gateway')));
    expect(failure.status).toBe('backend_error');
    expect(failure.httpStatus).toBe(502);
    expect(failure.responseBody).toContain('502');
  });

  it('认不出来的错误兜底成 assertion_mismatch，不中断整条旅程', () => {
    const failure = asFailure(classifyThrown(new TypeError('x is not a function')));
    expect(failure.status).toBe('assertion_mismatch');
    expect(failure.detail).toContain('未归类');
    expect(failure.actual).toContain('TypeError');
  });

  it('字符串也能进来（不是所有抛出的东西都是 Error）', () => {
    const failure = asFailure(classifyThrown('something odd happened'));
    expect(failure.status).toBe('assertion_mismatch');
    expect(failure.actual).toContain('something odd');
  });

  it('三类互斥：同一个错误不会同时命中两条规则', () => {
    const statuses = [
      classifyThrown(new Error('Timeout 30000ms exceeded')).status,
      classifyThrown(new Error('HTTP 500')).status,
      classifyThrown(new Error('boom')).status,
    ];
    expect(new Set(statuses).size).toBe(3);
  });
});
