/**
 * 判对错。
 *
 * 校验通过后才会调用；这里仍对类型不符的情况返回 `invalid`，因为
 * `level_items.answer` 是 jsonb —— 库层面没有约束禁止有人把某道题的
 * answer 写成 `{"value": "A"}`（0004 之前的 seed 就是这么写的形状）。
 * 与其抛 500，不如把它当成「这道题当前无法判分」并让调用方给出可读的 422。
 */
export type Judgement =
  | { verdict: 'correct' | 'wrong' }
  | { verdict: 'invalid'; reason: string };

/** 选择题判分：下标相等。 */
function judgeChoice(expected: number, actual: unknown): Judgement {
  if (typeof actual !== 'number' || !Number.isInteger(actual)) {
    return { verdict: 'invalid', reason: '这是一道选择题，answer 必须是选项下标（整数）' };
  }
  if (actual < 0) {
    return { verdict: 'invalid', reason: '选项下标不能是负数' };
  }
  return { verdict: actual === expected ? 'correct' : 'wrong' };
}

/**
 * 填空题判分：**先精确后宽松**。
 *
 * 精确优先是必要的 —— 数学式子的空白差异不该判错，但 `A+B` 与 `A + B` 之外
 * 的差异（例如 `A-B`）仍要判错。所以顺序是：去首尾空白比一次 → 折叠内部
 * 空白比一次 → 都不同就是错。**不做大小写折叠**：布尔表达式里的大小写
 * 常是不同变量（A 与 a 在两个不同位置可能是不同信号）。
 */
function judgeText(expected: string, actual: unknown): Judgement {
  if (typeof actual !== 'string') {
    return { verdict: 'invalid', reason: '这是一道填空题，answer 必须是字符串' };
  }
  const normalize = (value: string): string => value.trim().replace(/\s+/g, ' ');
  return normalize(expected) === normalize(actual) ? { verdict: 'correct' } : { verdict: 'wrong' };
}

/**
 * 按 `level_items.answer` 的类型选判分方式。
 *
 * `expected` 是 jsonb 解析后的值：数字 → 选择题，字符串 → 填空题。其它形状
 * （对象、数组、null）说明内容侧写坏了，返回 `invalid` 而不是猜。
 */
export function judgeAnswer(expected: unknown, actual: unknown): Judgement {
  if (typeof expected === 'number') return judgeChoice(expected, actual);
  if (typeof expected === 'string') return judgeText(expected, actual);
  return {
    verdict: 'invalid',
    reason: '这道题的正确答案不是数字也不是字符串，无法判分（内容数据有问题）',
  };
}

/** 选择题选项个数，用于越界检查。`options` 是 jsonb 数组。 */
export function optionCount(options: unknown): number {
  return Array.isArray(options) ? options.length : 0;
}
