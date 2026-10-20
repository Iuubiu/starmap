/**
 * 第二层的输出模型与人类可读摘要。
 *
 * 报告里关于「点击几次、卡在哪一步、输入框清空几次」的数字都从
 * `friction` 与 `steps` 来。所以这两块字段名一旦定下就不该改 ——
 * 历史报告要能比。新增字段可以，重命名不行。
 */

import type { StepRecord } from './action.ts';

export interface WalkthroughResult {
  actor: string;
  webUrl: string;
  startedAt: string;
  durationMs: number;
  steps: StepRecord[];
  friction: {
    locatorFailure: number;
    ambiguousTarget: number;
    notActionable: number;
    protocolViolation: number;
    gaveUpAt: number | null;
    skipped: number;
    acts: number;
  };
  consoleErrors: string[];
  screenSnapshots: number;
  urls: Array<{ stage: string; url: string; heading: string | null }>;
}

const OUTCOME_LABEL: Record<string, string> = {
  acted: '已执行',
  locator_failure: '找不到目标',
  ambiguous_target: '目标有歧义',
  not_actionable: '目标不可操作',
  protocol_violation: '输出不合协议',
  gave_up: '放弃',
  skipped: '跳过',
};

export function summarizeWalkthrough(result: WalkthroughResult): string {
  const lines: string[] = [
    '',
    `第二层最小旅程 · ${result.webUrl}`,
    `actor=${result.actor}  截图快照=${result.screenSnapshots}  耗时=${result.durationMs}ms`,
    '─'.repeat(72),
  ];

  for (const step of result.steps) {
    const label = OUTCOME_LABEL[step.outcome] ?? step.outcome;
    const hint = step.action?.target_hint?.trim() || '(无 hint)';
    lines.push(`第 ${step.turn} 步 · ${label} · ${step.durationMs}ms`);
    lines.push(`  hint：${hint}`);
    if (step.target) {
      lines.push(`  命中：${step.target.role}「${step.target.name}」`);
    }
    lines.push(`  ${step.detail}`);
    if (step.candidates && step.outcome === 'locator_failure') {
      const names = step.candidates.slice(0, 5).map((candidate) => `${candidate.role}「${candidate.name}」`);
      lines.push(`  当时页面上的候选（前 5）：${names.join('、') || '无'}`);
    }
  }

  lines.push('─'.repeat(72));
  lines.push('页面轨迹：');
  for (const entry of result.urls) {
    lines.push(`  ${entry.stage}: ${entry.url || '/'}${entry.heading ? ` · heading「${entry.heading}」` : ' · 无 heading'}`);
  }

  lines.push('─'.repeat(72));
  const { friction } = result;
  lines.push(
    `成功动作 ${friction.acts} 次｜找不到目标 ${friction.locatorFailure} 次｜有歧义 ${friction.ambiguousTarget} 次｜` +
      `不可操作 ${friction.notActionable} 次｜协议违规 ${friction.protocolViolation} 次｜跳过 ${friction.skipped} 次` +
      `｜放弃于第 ${friction.gaveUpAt ?? '—'} 步`,
  );
  if (result.consoleErrors.length > 0) {
    lines.push(`console error ${result.consoleErrors.length} 条：`);
    for (const error of result.consoleErrors.slice(0, 5)) lines.push(`  · ${error}`);
  } else {
    lines.push('console error：0 条');
  }
  lines.push('');
  return lines.join('\n');
}
