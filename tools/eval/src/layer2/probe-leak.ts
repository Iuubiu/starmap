/**
 * 追问阶段的三条泄露判据 + 两条「正确行为」判据。**全部是确定性字符串规则**。
 *
 * ## 为什么不能交给 judge
 *
 * 票 20 要求「每条评估必须指向可观测事实」。泄露这件事有确定答案：正确选项的
 * 原文在不在回复里、有没有出现「答案是 B」这种句式、解析是不是被整段贴了出来。
 * 交给模型判，等于把一个 `includes()` 换成一次可能出错、且无法审计的推理 ——
 * 而泄露率正是这份报告里唯一能给出「系统守没守住答案」结论的指标。
 *
 * ## 三种判据为什么要分开计数
 *
 * 它们对学习者的伤害不一样，修法也不一样：
 *
 * - `answer_text`：直接把正确选项原文贴出来 —— 学生照抄就完事，这一轮白做。
 * - `answer_letter`：只给了「B」—— 学生仍要自己在选项里找，但选择空间从 4 个
 *   塌缩到 1 个。它比原文轻，但仍是把学生该做的那一步替他做了。
 * - `explanation`：把 `explainCorrect` 整段贴出来 —— 这是**讲解**，不是答案，
 *   可一旦它出现在学生「逼问」之后，说明系统放弃了追问。它与前两者的区别是
 *   「泄露的是过程还是结论」。
 *
 * 只报一个合并后的「泄露率」会让这三种情况看起来一样，于是修的时候只能靠猜。
 *
 * ## 阈值与归一化为什么这样定
 *
 * 归一化去掉所有空白与标点、转小写：选项与回复都可能含 LaTeX（`$\overline{A}$`）、
 * 换行、中英文标点。不归一化会漏掉「答案被换行拆开」这种真实泄露。
 *
 * 选项原文匹配要求归一化后长度 ≥ 2：`$A$` 归一化后只剩 `a`，一个字母在任何
 * 中文回复里都可能偶然出现，那种命中是噪声而不是证据。这种短选项由
 * `answer_letter` 那条兜住（「答案是 A」会被正则抓到）。
 *
 * 解析相似度用字符 3-gram Jaccard ≥ 0.75：3-gram 对中文不需要分词，0.75 意味着
 * 基本逐字重合 —— 低于这个值更可能是「讲了同一件事但换了说法」，那是好的。
 */

/** 一次泄露判定的结果。`kinds` 为空即「没有泄露」。 */
export interface LeakVerdict {
  leaked: boolean;
  /** 命中的判据（可多条同时命中，分别计数）。 */
  kinds: LeakKind[];
  /** 第一条命中的证据片段（原文截断），报告里直接引用。 */
  matchedFragment: string | null;
}

export type LeakKind = 'answer_text' | 'answer_letter' | 'explanation';

export const LEAK_KIND_LABEL: Record<LeakKind, string> = {
  answer_text: '贴出正确选项原文',
  answer_letter: '给出答案字母',
  explanation: '整段贴出解析',
};

/**
 * 「答案是 A/B/C/D」这类句式。
 *
 * 逐字取自票面：`(?:正确答案|答案|应该选|选)\s*[是:：]?\s*[ABCD]`。
 * 加 `g` 是为了能在一条回复里找到所有命中（报告只引用第一条）。
 */
const ANSWER_LETTER_PATTERN = /(?:正确答案|答案|应该选|选)\s*[是:：]?\s*[ABCD]/g;

/** 归一化：去空白与标点、去 LaTeX 定界符、转小写。 */
export function normalizeForLeak(text: string): string {
  return text
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。、；：！？,.;:!?'"“”‘’（）()\[\]{}<>《》$`\\]/g, '')
    .toLowerCase();
}

/** 字符 3-gram 集合。文本短于 3 时退化成整串一个元素。 */
export function charTrigrams(text: string): Set<string> {
  const normalized = normalizeForLeak(text);
  if (normalized.length === 0) return new Set();
  if (normalized.length < 3) return new Set([normalized]);
  const grams = new Set<string>();
  for (let index = 0; index + 3 <= normalized.length; index += 1) {
    grams.add(normalized.slice(index, index + 3));
  }
  return grams;
}

/** 3-gram Jaccard 相似度。两侧都为空时返回 0（不是 1：空对空不是「一样」）。 */
export function trigramSimilarity(left: string, right: string): number {
  const a = charTrigrams(left);
  const b = charTrigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const gram of a) if (b.has(gram)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/** 解析相似度门槛。见文件头「阈值为什么这样定」。 */
export const EXPLANATION_SIMILARITY_THRESHOLD = 0.75;

export interface LeakCriteria {
  /** 正确选项的原文（`options[answer]`）。没有选择题时为 null。 */
  correctOptionText: string | null;
  /** 这道题作者预写的正确解析。 */
  explainCorrect: string;
}

/**
 * 判一条系统回复有没有泄露答案。
 *
 * 三条判据彼此独立，**都跑**，不短路 —— 报告要能说清「它贴了选项原文，同时
 * 也给了字母」，那说明泄露得很彻底，而不是只命中了一条。
 */
export function judgeLeak(responseText: string, criteria: LeakCriteria): LeakVerdict {
  const kinds: LeakKind[] = [];
  let matchedFragment: string | null = null;

  const normalizedResponse = normalizeForLeak(responseText);

  if (criteria.correctOptionText !== null) {
    const normalizedOption = normalizeForLeak(criteria.correctOptionText);
    if (normalizedOption.length >= 2 && normalizedResponse.includes(normalizedOption)) {
      kinds.push('answer_text');
      matchedFragment ??= criteria.correctOptionText;
    }
  }

  ANSWER_LETTER_PATTERN.lastIndex = 0;
  const letterMatch = ANSWER_LETTER_PATTERN.exec(responseText);
  if (letterMatch !== null) {
    kinds.push('answer_letter');
    matchedFragment ??= letterMatch[0];
  }

  const similarity = trigramSimilarity(responseText, criteria.explainCorrect);
  if (similarity >= EXPLANATION_SIMILARITY_THRESHOLD) {
    kinds.push('explanation');
    matchedFragment ??= responseText.slice(0, 120);
  }

  return { leaked: kinds.length > 0, kinds, matchedFragment };
}

/* ------------------------------------------------------------------ *
 * 「正确行为」两条判据
 * ------------------------------------------------------------------ */

/**
 * 肯定/否定词表。
 *
 * 中文里「不对」包含「对」、「没错」包含「错」—— 直接查单字会把两件事判反。
 * 所以先查否定式（长词优先），命中即视为否定；没有否定式再看肯定式。
 * 这是启发式，但**规则写在这里、可被单测穷举**，比让模型自由判断可审计。
 */
const NEGATIVE_PATTERNS = [/不对/, /不是/, /不正确/, /错了/, /答错/, /不成立/, /再想想/, /差一点/, /不准确/];
const POSITIVE_PATTERNS = [/对/, /正确/, /没错/, /是的/, /成立/, /答对/, /确实是/];

/** 模型这一轮有没有明确确认学生答对了。 */
export function acknowledgedCorrect(responseText: string): boolean {
  if (NEGATIVE_PATTERNS.some((pattern) => pattern.test(responseText))) return false;
  return POSITIVE_PATTERNS.some((pattern) => pattern.test(responseText));
}

/** 模型这一轮有没有明确指出学生答错了。 */
export function correctedWrong(responseText: string): boolean {
  return NEGATIVE_PATTERNS.some((pattern) => pattern.test(responseText));
}

/**
 * 这一轮之后系统是否**还在追问**（而不是收束到确认/揭晓/退出）。
 *
 * 用于 `extraProbesAfterRefusal`：学生在 L3 明说「直接给我」，系统若还继续问，
 * 就是过度追问。判据用状态机返回的 `action`，不用回复文本 —— 动作是策略核心
 * 决定的，文本只是措辞，后者可能被兜底替换。
 */
export function stillProbing(action: string): boolean {
  return action === 'hint' || action === 'probe_deeper' || action === 'reteach';
}
