/**
 * 出口门控。纯函数。
 *
 * 设计取舍（D3）：门控只出现在章末出口与高入度先修节点，关内允许失败。
 * 理由：Sinha & Kapur 2021（53 研究/166 比较）显示「先探索后讲」优于「先讲后探索」，
 * 关内硬门会把探索本身掐死。
 */

export interface GateRule {
  mode: 'none' | 'exit' | 'prereq';
  itemCount: number;
  passCount: number;
}

export type GateVerdict = 'passed' | 'failed' | 'undetermined';

export interface GateResult {
  passed: boolean;
  verdict: GateVerdict;
  reason: 'passed' | 'below_threshold' | 'insufficient_items' | 'no_gate_configured';
  /** 还差几题；通过时为 0 */
  shortfall: number;
  /** 面向学习者的中文说明（D10：所有展示内容中文） */
  message: string;
}

/** 数值来自 spec 表 3：章末 8 题 ≥7、高入度先修 10 题 ≥9 */
export const GATE_RULES: Record<'exit' | 'prereq', GateRule> = {
  exit: { mode: 'exit', itemCount: 8, passCount: 7 },
  prereq: { mode: 'prereq', itemCount: 10, passCount: 9 },
};

export function evaluateExitGate(correct: number, total: number, rule: GateRule): GateResult {
  if (rule.mode === 'none') {
    return {
      passed: false,
      verdict: 'undetermined',
      reason: 'no_gate_configured',
      shortfall: rule.passCount,
      message: '此处不设门控，关内允许自由尝试。',
    };
  }

  if (total < rule.itemCount) {
    return {
      passed: false,
      verdict: 'undetermined',
      reason: 'insufficient_items',
      shortfall: rule.passCount - correct,
      message: `题量不足：需完成 ${rule.itemCount} 题，当前 ${total} 题。`,
    };
  }

  // 边界截断：答对数不会超过题量，避免负差距
  const effectiveCorrect = Math.min(correct, total);

  if (effectiveCorrect >= rule.passCount) {
    return {
      passed: true,
      verdict: 'passed',
      reason: 'passed',
      shortfall: 0,
      message: `已通过：答对 ${effectiveCorrect}/${total}，达标线 ${rule.passCount}。`,
    };
  }

  const shortfall = rule.passCount - effectiveCorrect;
  return {
    passed: false,
    verdict: 'failed',
    reason: 'below_threshold',
    shortfall,
    message: `还差 ${shortfall} 题：答对 ${effectiveCorrect}/${total}，达标线 ${rule.passCount}。`,
  };
}
