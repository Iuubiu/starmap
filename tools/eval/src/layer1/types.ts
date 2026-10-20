/**
 * 第一层：确定性断言的结果模型。
 *
 * 三种状态而不是布尔：`skipped` 必须存在，而且必须**带原因**。
 *
 * 为什么要三态：票 20 里三条不变量中的后两条（门控、跨知识点结论相反）
 * 依赖的接口现在还不存在（票 06/09/11 未实现）。如果把它们写成"接口不存在
 * 就通过"，报告会显示 100% 通过率，而这三条其实一条都没验；写成"跳过"
 * 跑完就没人看。所以 skipped 在报告里单独占一列，并且覆盖率是算出来的数字，
 * 不是 impression。
 */

export type CheckStatus = 'passed' | 'failed' | 'skipped';

export interface CheckResult {
  /** 稳定 id，报告与 diff 都按它对齐。 */
  id: string;
  /** 一句话说明这条断言在验什么。 */
  title: string;
  status: CheckStatus;
  /** 人类可读的证据：实际观察到的值，不是"期望 X 得到 Y"的模板句。 */
  evidence: string;
  /** 可被报告消费的数字，键名稳定。 */
  metrics?: Record<string, number>;
  /** status==='skipped' 时必填：为什么没跑，以及什么条件下能跑。 */
  skippedReason?: string;
  /** 毫秒。第一层要一直很快，慢了说明有人把 LLM 混进来了。 */
  durationMs: number;
}

export interface SuiteResult {
  suite: string;
  startedAt: string;
  durationMs: number;
  baseUrl: string;
  results: CheckResult[];
}

export function summarize(suite: SuiteResult): {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  /** 真正验过的比例（skipped 不计入分子也不计入分母的"覆盖"视角另算）。 */
  passRateOfExecuted: number;
  coverageRate: number;
} {
  const total = suite.results.length;
  const passed = suite.results.filter((r) => r.status === 'passed').length;
  const failed = suite.results.filter((r) => r.status === 'failed').length;
  const skipped = suite.results.filter((r) => r.status === 'skipped').length;
  const executed = total - skipped;
  return {
    total,
    passed,
    failed,
    skipped,
    passRateOfExecuted: executed === 0 ? 0 : passed / executed,
    coverageRate: total === 0 ? 0 : executed / total,
  };
}
