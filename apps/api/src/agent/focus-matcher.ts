/**
 * 「学习者这句话在说哪个知识点」的匹配器（t56）。
 *
 * ## 为什么需要它
 *
 * t49 让「没选知识点」的会话不再返回占位卡：服务端按推荐挑一个焦点。但那套
 * 逻辑**完全不看学习者说了什么** —— 说「我想学布尔代数」和说「我想了解电离室
 * 的工作原理」拿到的是同一张卡（实测都落到 `kp-knoll-4e-2010-10-5`），因为
 * 推荐列表按模块/深度/序号排序，全库第一条是固定的。学生第一句话就被无视，
 * 后面再准的推荐也救不回来。
 *
 * ## 为什么不用 LLM
 *
 * 这件事有确定答案：知识点名字就写在库里。让模型把「布尔代数」翻译成
 * `kp-bool` 意味着每轮多一次网络往返、多一个可能失败/编造的环节，而它并不比
 * 一次字符串匹配更准。匹配是纯函数，可以单测、可以断言「同样输入两次同一结果」。
 *
 * ## 为什么不用新表/向量
 *
 * 知识点只有 4030 个、名字平均 8 个字。子串匹配在毫秒级，加一层索引或向量库
 * 只会让「名字改了索引没更新」变成新的静默故障。
 *
 * ## 通用词问题（这是本模块真正要解决的那件事）
 *
 * 朴素的「名字出现在句子里」会让通用词赢：库里真有叫 `：工作原理` 的节点，
 * 于是「我想了解电离室的工作原理」会命中它而不是 `电离室`。库里的实测分布
 * （4030 个知识点）：`习题` 85 个、`思考题` 57 个、`参考文献` 27 个、`小结` 20
 * 个、`本章小结` 19 个、`工作原理` 2 个 —— 这些名字**整名就是通用词**，它们
 * 不是任何一句话的主题。所以：
 *
 *   1. 整名落在停用词表里的候选直接丢弃（不是降权，是丢弃）；
 *   2. 打分主键是**命中片段的长度**，其次是**命中片段占名字的比例** ——
 *      「电离室」（命中 3 字、占 100%）赢过任何只沾了两个字的候选；
 *   3. 命中片段少于 3 字一律不算（两字名字例外：整名出现才算）。
 */

export interface FocusCandidate {
  microKpId: string;
  name: string;
  isLeaf: boolean;
  depth: number;
}

export interface FocusMatch {
  microKpId: string;
  name: string;
  /** 名字里被句子命中的那一段（归一化之后的形式） */
  matchedText: string;
  /** 命中片段长度占名字长度的比例，用于排序与日志 */
  coverage: number;
}

export const FOCUS_MATCH_LIMITS = {
  /** 命中片段的最小长度。低于 3 字的匹配在中文里噪音极大（「方法」「系统」） */
  minCommonLength: 3,
  /** 命中片段至少要覆盖名字的一半，否则「沾了两个字」的长名字会淹没精确匹配 */
  minCoverage: 0.5,
  /** 名字最长只看到 30 字；更长的名字本身就不像一个知识点标题 */
  maxNameWindow: 30,
} as const;

/**
 * 整名等于这些词的知识点不是「一句话的主题」。
 *
 * 名单来自真实库的频率统计（括号里是 4030 个知识点中的条数），不是凭感觉列的：
 * `习题`(85) `思考题`(57) `参考文献`(27) `小结`(20) `本章小结`(19) `全文`(12)
 * `自测题`(10) `引言`(9) `结论`(7) `附录`(7) `数据获取`(6) `示例`(5) `绪论`(4)
 * `概述`(3) `继续`(3) `一般描述`(3) `工作原理`(2) `系统`(2)。
 *
 * 后面几个（`方法`/`原理`/`概念`/`结构`/`定义`/`分类`/`应用`/`特点`/`简介`/
 * `基础`/`技术`/`计算`/`系统`）在库里各只有 1–2 个节点，但它们是典型的「句子里
 * 随便就会出现」的词，留着就会在别的书上重复同一个 bug。
 */
export const GENERIC_FOCUS_NAMES: ReadonlySet<string> = new Set(
  [
    '习题',
    '练习题',
    '思考题',
    '复习题',
    '自测题',
    '例题',
    '练习',
    '参考文献',
    '小结',
    '本章小结',
    '总结',
    '全文',
    '引言',
    '绪论',
    '前言',
    '结论',
    '附录',
    '数据获取',
    '示例',
    '概述',
    '继续',
    '一般描述',
    '工作原理',
    '基本概念',
    '主要内容',
    '学习目标',
    '知识要点',
    '方法',
    '原理',
    '概念',
    '结构',
    '定义',
    '分类',
    '应用',
    '特点',
    '简介',
    '基础',
    '技术',
    '计算',
    '系统',
  ].map(normalizeFocusText),
);

/**
 * 归一化：去掉空白、中英文标点与破折号，转小写。
 *
 * 为什么要去标点：库里既有 `G-M计数管` 也有 `G−M 计数管`（减号是 U+2212），
 * 而学生打的是 `G-M计数管`。标点差异不该决定匹配成败。
 */
export function normalizeFocusText(text: string): string {
  return text
    .replace(/[\s\u3000]/g, '')
    // 注意 `\u2212`：PDF 里的减号常常是这个数学减号而不是 ASCII 连字符，
    // 库里同时存在 `G-M计数管` 与 `G−M计数管` 两种写法。
    .replace(/[：:、，,。.；;！!？?“”"'‘’（）()【】\[\]《》<>·・\-\u2212—–_/\\|]/g, '')
    .toLowerCase();
}

function bigramsOf(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 2 <= text.length; i += 1) out.push(text.slice(i, i + 2));
  return out;
}

/** 句子里所有长度 ≤ maxNameWindow 的子串，用来把「找最长公共子串」变成一次 Set 查询。 */
function buildUtteranceWindows(utterance: string): Set<string> {
  const windows = new Set<string>();
  const maxLen = Math.min(FOCUS_MATCH_LIMITS.maxNameWindow, utterance.length);
  for (let len = 2; len <= maxLen; len += 1) {
    for (let i = 0; i + len <= utterance.length; i += 1) {
      windows.add(utterance.slice(i, i + len));
    }
  }
  return windows;
}

/** 名字里最长的、同时出现在句子里的片段（长度从名字上限往下试，第一次命中即最长）。 */
function longestSharedFragment(
  name: string,
  windows: Set<string>,
  minLength: number,
): string | null {
  const maxLen = Math.min(name.length, FOCUS_MATCH_LIMITS.maxNameWindow);
  for (let len = maxLen; len >= minLength; len -= 1) {
    for (let i = 0; i + len <= name.length; i += 1) {
      const fragment = name.slice(i, i + len);
      if (windows.has(fragment)) return fragment;
    }
  }
  return null;
}

/**
 * 在候选知识点里挑出「这句话在说哪一个」。
 *
 * 返回 null 表示**没有线索**，调用方应当回落到推荐（这是 t49 的既有行为）。
 * 这里刻意不返回「最接近的那个」：如果学生说的是「我不知道从哪开始」，
 * 硬凑一个知识点比老实回落更糟。
 */
export function matchFocus(
  utterance: string,
  candidates: readonly FocusCandidate[],
): FocusMatch | null {
  const normalizedUtterance = normalizeFocusText(utterance);
  if (normalizedUtterance.length < 2) return null;

  const windows = buildUtteranceWindows(normalizedUtterance);

  let best: { match: FocusMatch; isLeaf: boolean; depth: number } | null = null;

  for (const candidate of candidates) {
    const name = normalizeFocusText(candidate.name);
    if (name.length === 0) continue;
    // 整名就是通用词：它不是主题，直接丢弃（见文件头「通用词问题」）。
    if (GENERIC_FOCUS_NAMES.has(name)) continue;

    // 必要条件预筛：任何长度 ≥2 的公共子串都至少含一个公共二元组。
    // 这一步把 4030 个候选压到个位数，后面的最长片段搜索才跑得动。
    const nameBigrams = bigramsOf(name);
    if (nameBigrams.length > 0 && !nameBigrams.some((b) => windows.has(b))) continue;

    const minLength = Math.min(name.length, FOCUS_MATCH_LIMITS.minCommonLength);
    const fragment = longestSharedFragment(name, windows, minLength);
    if (fragment === null) continue;

    const coverage = fragment.length / name.length;
    if (coverage < FOCUS_MATCH_LIMITS.minCoverage) continue;

    const match: FocusMatch = {
      microKpId: candidate.microKpId,
      name: candidate.name,
      matchedText: fragment,
      coverage,
    };

    if (best === null || isBetter(match, candidate, best.match, best)) {
      best = { match, isLeaf: candidate.isLeaf, depth: candidate.depth };
    }
  }

  return best === null ? null : best.match;
}

/**
 * 排序规则（全部是确定性的，同样输入永远同一结果）：
 *
 * 1. **整名命中优先**（`coverage === 1`）—— 两字及以上的名字被整段说出来，
 *    是最强信号，不该输给某个更长的名字里的偶然片段；
 * 2. 命中片段更长者优先；
 * 3. 覆盖率更高者优先；
 * 4. 叶节点优先 —— 焦点要能打开关卡，挂在章节上的节点点进去是空的；
 * 5. 层级更浅者优先；
 * 6. 名字更短者优先 —— 短名字通常更具体；
 * 7. `microKpId` 字典序兜底，保证同名同分时结果稳定（不依赖数据库返回顺序）。
 *
 * ## 为什么第 1 条必须排在「片段更长」前面
 *
 * 真实库实测（2026-10-22，4030 个知识点）：说「我想了解电离室的工作原理」时，
 * 只按片段长度排序会选中 `一、火花放电室的工作原理` —— 它和这句话的公共片段是
 * 「室的工作原理」（6 字），而真正的 `电离室` 只有 3 字。结果学习者说要电离室，
 * 卡片讲的是火花放电室。长度优先在「长名字恰好沾了一串常用词」时会系统性出错，
 * 而整名命中不会。
 */
function isBetter(
  match: FocusMatch,
  candidate: FocusCandidate,
  bestMatch: FocusMatch,
  best: { match: FocusMatch; isLeaf: boolean; depth: number },
): boolean {
  const exact = match.coverage >= 1;
  const bestExact = bestMatch.coverage >= 1;
  if (exact !== bestExact) return exact;

  if (match.matchedText.length !== bestMatch.matchedText.length) {
    return match.matchedText.length > bestMatch.matchedText.length;
  }
  if (match.coverage !== bestMatch.coverage) return match.coverage > bestMatch.coverage;
  if (candidate.isLeaf !== best.isLeaf) return candidate.isLeaf;
  if (candidate.depth !== best.depth) return candidate.depth < best.depth;
  if (match.name.length !== bestMatch.name.length) return match.name.length < bestMatch.name.length;
  return match.microKpId < bestMatch.microKpId;
}
