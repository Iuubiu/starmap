/**
 * 第二层：模拟用户动作的解析与校验。
 *
 * 设计前提（票 20 硬要求）：**LLM 只输出意图，不输出选择器**。
 * 模型给 `{"action":"click","target_hint":"上面那排第二个卡片"}`，
 * 由确定性代码把 target_hint 解析成真实的 DOM 目标。理由：
 * ① 让模型写 CSS 选择器等于让它猜实现细节，猜错时错误信息毫无用处；
 * ② 选择器由模型生成，测试就无法区分"产品坏了"和"模型猜错了"；
 * ③ target_hint 解析失败本身是**可用性发现**（连描述都指不准的界面，
 *    人类新用户多半也指不准），必须记下来而不是重试掩盖。
 */

import { z } from 'zod';

export const ActionNameSchema = z.enum(['type', 'click', 'scroll', 'submit_form', 'skip', 'give_up']);

export const FeltSchema = z.object({
  effort: z.number().int().min(1).max(9),
  confusion: z.number().int().min(0).max(3),
  frustration: z.number().int().min(0).max(3),
});

export const AgentActionSchema = z.object({
  action: ActionNameSchema,
  /** 自然语言描述位置；type/submit_form 时可为空（如对已聚焦输入框输入）。 */
  target_hint: z.string().default(''),
  text: z.string().default(''),
  felt: FeltSchema.optional(),
  /** 内心独白，≤40 字。报告里只摘 ≤5 条，但每次都要存。 */
  note: z.string().default(''),
});

export type AgentAction = z.infer<typeof AgentActionSchema>;
export type ActionName = z.infer<typeof ActionNameSchema>;

export interface ParseOutcome {
  ok: boolean;
  action: AgentAction | null;
  /** 模型没按协议输出时记这里；这是可观测指标，不是崩溃。 */
  protocolError: string | null;
  /** 原始文本，报告里要能回看模型到底写了什么。 */
  raw: string;
}

/**
 * 从模型输出里抽出 JSON 对象。
 *
 * 三条真实会遇到的脏数据，都必须容忍而不是当成崩溃：
 *  ① 用 ```json 围栏包起来（最常见）；
 *  ② 前后带一句解释（"好的，我现在点击..."）；
 *  ③ 字段缺失（模型偶尔漏 note）。
 * 容忍 ①②③ 不等于容忍胡说：JSON 解不出来或 action 不在枚举里，一律记
 * protocol_violation —— 这是要计数的失败，不是要兜底的异常。
 */
export function parseAgentAction(raw: string): ParseOutcome {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, action: null, protocolError: '模型输出为空', raw };
  }

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = (fenced?.[1] ?? trimmed).trim();

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return { ok: false, action: null, protocolError: `输出里没有 JSON 对象：${trimmed.slice(0, 120)}`, raw };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
  } catch (error) {
    return {
      ok: false,
      action: null,
      protocolError: `JSON 解析失败：${(error as Error).message}｜片段：${candidate.slice(0, 120)}`,
      raw,
    };
  }

  const validated = AgentActionSchema.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}：${issue.message}`);
    return { ok: false, action: null, protocolError: `字段不合协议：${issues.join('；')}`, raw };
  }

  return { ok: true, action: validated.data, protocolError: null, raw };
}

/**
 * 单步动作的结局。`outcome` 是报告漏斗与 friction 计数的唯一来源，
 * 所以每个取值都必须有明确、互斥的含义。
 */
export type StepOutcome =
  /** 动作执行成功（点击命中、输入成功）。 */
  | 'acted'
  /** target_hint 解析不到任何目标 —— 记 locator_failure，不重试。 */
  | 'locator_failure'
  /** target_hint 解析出多个同分候选 —— 同样记 locator_failure（歧义也是缺陷）。 */
  | 'ambiguous_target'
  /** 目标存在但不可见/被遮挡/disabled。 */
  | 'not_actionable'
  /** 模型输出不合协议。 */
  | 'protocol_violation'
  /** 学生主动放弃。 */
  | 'gave_up'
  /** 显式跳过（本题不会，换一道）。 */
  | 'skipped';

export interface StepRecord {
  turn: number;
  stage: string;
  action: AgentAction | null;
  outcome: StepOutcome;
  /** 命中时的目标描述：role + accessible name，可直接用于报告定位。 */
  target?: { role: string; name: string; index: number };
  /** 解析失败/歧义时的候选清单（截断到 8 条），报告要能复现。 */
  candidates?: Array<{ role: string; name: string; index: number }>;
  /** 给报告的一句话说明。 */
  detail: string;
  durationMs: number;
}
