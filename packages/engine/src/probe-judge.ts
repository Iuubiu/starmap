/**
 * 追问回复的**独立 judge**（票 10）。
 *
 * 为什么需要一个「独立」的 judge：生成回复的那个模型同时也是最想把答案
 * 说出来的东西（arXiv:2608.12292 的实测里，模型被反复施压后会主动泄题）。
 * 用同一个模型自评等于让它给自己判卷。所以这里是纯函数、按**拒绝原因**
 * 分类，不调用任何 LLM。
 *
 * 为什么按原因分类而不是给一个通过率：spec §6 明确说，过度拒绝（把学生
 * 诚实的求助判成越界）比帮助不足危害更大 —— 只有分开统计「泄露最终数值」
 * 「泄露公式」「直接给答案」「一轮多问」才能看出是哪一类在误伤。
 *
 * 判定刻意保守：宁可漏判（模型用迂回说法泄题），也不要把正常提示判成
 * 越界。每条规则都只匹配**明确的**泄露措辞。
 *
 * 纯函数、无 IO、无框架依赖（engine 包的硬约束）。
 */
import { countQuestions } from './text-guard.js';

export type ProbeJudgeReason =
  | 'leaks_final_value'
  | 'leaks_formula'
  | 'reveals_answer'
  | 'multiple_questions'
  | 'probe_without_question';

export interface ProbeJudgeInput {
  /** 待判定的文本（模型候选或最终展示文本） */
  text: string;
  /** 这一轮是「追问」形态还是「陈述」形态。只有追问形态才要求有问号。 */
  isProbe: boolean;
  /** 期望的最终数值。给了才判「泄露最终数值」。 */
  expectedValue?: number | null;
  /** 期望的公式（例如 `Q = CV`）。给了才判「泄露公式」。 */
  expectedFormula?: string | null;
}

export interface ProbeJudgeVerdict {
  passed: boolean;
  reasons: ProbeJudgeReason[];
  /** 本轮回复里出现了几个问号（中文与英文问号都算） */
  questionCount: number;
}

/** 「直接给答案」的明确措辞。不含「答案是什么？」这种提问。 */
const REVEAL_PATTERNS: readonly RegExp[] = [
  /答案(是|为|就是)/,
  /正确(答案|结果|数值)(是|为)/,
  /直接(告诉|给出|说)(你)?(答案|结果|数值)/,
  /最终(结果|数值|答案)(是|为)/,
  /结论(是|为)/,
  /(应该|就)是\s*[-+]?\d/,
];

/**
 * 公式泄露的形态：出现了一个**等式**。
 *
 * 只认「左边是符号、右边不是符号」的形态，因为正常中文提示里不会出现
 * `Q = CV`；而 "2/3"、"P1/P2" 这类分数、档位名不会命中（没有等号）。
 */
const EQUATION = /[A-Za-zα-ωΑ-Ω][A-Za-z0-9_^{}()\s]{0,12}=[^=]{1,40}/;

/** 去掉空格与 LaTeX 花括号差异后的规范化，用于比对期望公式。 */
function normalizeFormula(text: string): string {
  return text.replace(/[\s{}$\\]/g, '').toLowerCase();
}

/** 把期望数值可能出现的写法都列出来（1234 / 1,234 / 1.234e3 / 1234.0）。 */
function valueVariants(value: number): string[] {
  const out = new Set<string>();
  out.add(String(value));
  out.add(value.toFixed(1));
  out.add(value.toFixed(2));
  out.add(value.toFixed(3));
  if (Number.isInteger(value)) {
    out.add(value.toLocaleString('en-US'));
    out.add(value.toExponential(1).replace('+', ''));
  }
  return [...out];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 数值是否真的出现了。
 *
 * 不能直接 `includes`：期望值 5，提示里写「5.9 keV」就是误判；期望值 12，
 * 提示里写「123」也是。所以要求前后都不是数字的一部分：
 * - 前面不能紧挨数字或小数点（避免把 `5.9` 里的 `9` 当成期望值 9）；
 * - 后面不能是 `123` 里的 `23`，也不能是 `12.5` 里的小数位。
 */
function containsValue(text: string, value: number): boolean {
  const compact = text.replace(/\s/g, '');
  return valueVariants(value).some((variant) => {
    const pattern = new RegExp(`(?<![\\d.])${escapeRegExp(variant.replace(/\s/g, ''))}(?!\\.?\\d)`);
    return pattern.test(compact);
  });
}

/**
 * 判定一轮回复是否越界。
 *
 * `expectedValue` / `expectedFormula` 为空表示这一轮没有可比对的标准答案，
 * 此时只判「是否直接给答案」与「问题数量」——不给标准答案也能判泄露。
 */
export function judgeProbeReply(input: ProbeJudgeInput): ProbeJudgeVerdict {
  const text = input.text ?? '';
  const reasons: ProbeJudgeReason[] = [];
  const questionCount = countQuestions(text);

  if (input.expectedValue !== null && input.expectedValue !== undefined) {
    if (containsValue(text, input.expectedValue)) reasons.push('leaks_final_value');
  }

  const expectedFormula = input.expectedFormula;
  if (expectedFormula && expectedFormula.trim().length > 0) {
    if (normalizeFormula(text).includes(normalizeFormula(expectedFormula))) {
      reasons.push('leaks_formula');
    }
  }
  // 即使没有期望公式，出现等式也算泄露：提示的作用是让学生自己想起关系式。
  if (!reasons.includes('leaks_formula') && EQUATION.test(text)) {
    reasons.push('leaks_formula');
  }

  if (REVEAL_PATTERNS.some((p) => p.test(text))) reasons.push('reveals_answer');

  if (questionCount > 1) reasons.push('multiple_questions');
  if (input.isProbe && questionCount === 0) reasons.push('probe_without_question');

  return { passed: reasons.length === 0, reasons, questionCount };
}
