/**
 * 命令面板的模糊匹配 —— 纯函数，不碰 DOM、不碰 React。
 *
 * ## 为什么自己写而不是引一个库
 *
 * 三个理由，按重要性排：
 *
 * 1. **中文不分词**。fuse.js / match-sorter 的打分建立在「词」上，而中文没有
 *    空格分词，「布尔代数基本运算」对它们是一个 8 字符的长词。用户敲「代数」
 *    时那些库要么靠 substring 兜底（那就等于没打分），要么完全命不中。这里
 *    的匹配原语是**子串 + 子序列**，与分词无关，所以「布尔」「代数」「布尔
 *    代数」都能命中同一条。
 * 2. **零新依赖**。面板是导航路径上的东西，它不该让 `node_modules` 再长一截。
 * 3. **可测**。打分规则是产品决策（「前缀命中优先于中段命中」），写在这里
 *    能被单测钉住；藏在库里就只剩「感觉搜得还行」。
 *
 * ## 打分模型
 *
 * 每一档都是**基数**，长度惩罚与偏移惩罚从基数里减。这样「前缀」永远压过
 * 「中段」，不管后者多短：
 *
 * | 情形 | 基数 |
 * | --- | --- |
 * | 完全相同 | 1000 |
 * | 前缀命中（位置 0） | 800 |
 * | 词边界命中（`-`、空格、`·` 之后） | 600 |
 * | 中段子串 | 400 |
 * | 非连续子序列 | 100 |
 *
 * 减去 `0.5 × 文本长度`：同分时短名称排前（「卡诺图」比「卡诺图化简的三种
 * 情形」更可能是你想找的那个）。子序列再减 `1 × 跳过的字符数`，让紧凑的
 * 命中排在散落的命中前面。
 */

/** 一条可被匹配的文本：主文本（名字）与副标注（章节 / 路径）。 */
export interface FuzzyTarget {
  text: string;
  /** 副标注。参与匹配，但权重只有主文本的一半。 */
  hint?: string | undefined;
}

/** 命中结果。`ranges` 是主文本里要加亮的区间（`[start, end)`）。 */
export interface FuzzyMatch {
  score: number;
  ranges: Array<[number, number]>;
}

const SCORE_EXACT = 1000;
const SCORE_PREFIX = 800;
const SCORE_WORD_START = 600;
const SCORE_SUBSTRING = 400;
const SCORE_SUBSEQUENCE = 100;

/** 每字符长度惩罚：同分时短名称优先。 */
const LENGTH_PENALTY = 0.5;
/** 副标注的权重。 */
const HINT_WEIGHT = 0.5;
/** 子序列每跳过一个字符的惩罚。 */
const GAP_PENALTY = 1;

/**
 * 词边界字符。
 *
 * 中文里没有空格，但知识点名里确实会出现这些分隔（「数字逻辑·卡诺图化简」、
 * 「Knoll-第4版」），所以把它们当作「词开头」的证据。纯中文串里没有分隔符，
 * 于是「中段命中」就是最常见的形态 —— 这是对的，中文用户敲的就是词的一部分。
 */
const WORD_SEPARATORS = new Set([
  ' ',
  '\t',
  '-',
  '_',
  '/',
  '·',
  '、',
  '，',
  ',',
  '（',
  '(',
  '）',
  ')',
  '：',
  ':',
  '「',
  '」',
]);

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  return WORD_SEPARATORS.has(text.charAt(index - 1));
}

/**
 * 拼音首字母。
 *
 * ## 为什么不用一张汉字→字母的表
 *
 * 那种表要覆盖 3000+ 个知识点名里的全部汉字，体积比整个面板还大，而且每加
 * 一个新知识点都可能漏字。这里改用系统自带的拼音排序：ICU 的
 * `zh-Hans-u-co-pinyin` collator 把汉字按拼音排列，于是「这个字在哪些字之后」
 * 就足以确定它的声母 —— 用 23 个边界字做一次二分即可。
 *
 * 代价是依赖运行环境的 ICU 数据（Node 全量 ICU、Chrome/Edge 都有）。拿不到
 * collator 时返回空串，拼音命中整体降级掉，中文子串/子序列匹配不受影响。
 */
const PINYIN_INITIAL_BOUNDARIES: ReadonlyArray<readonly [string, string]> = [
  ['阿', 'A'],
  ['八', 'B'],
  ['擦', 'C'],
  ['搭', 'D'],
  ['蛾', 'E'],
  ['发', 'F'],
  ['噶', 'G'],
  ['哈', 'H'],
  ['击', 'J'],
  ['喀', 'K'],
  ['拉', 'L'],
  ['妈', 'M'],
  ['拿', 'N'],
  ['哦', 'O'],
  ['啪', 'P'],
  ['期', 'Q'],
  ['然', 'R'],
  ['撒', 'S'],
  ['塔', 'T'],
  ['挖', 'W'],
  ['昔', 'X'],
  ['压', 'Y'],
  ['匝', 'Z'],
];

/** 拼音首字母命中的权重：低于同名/同前缀，高于散落的子序列。 */
const INITIALS_WEIGHT = 0.85;

let collatorCache: Intl.Collator | null | undefined;

function pinyinCollator(): Intl.Collator | null {
  if (collatorCache !== undefined) return collatorCache;
  try {
    collatorCache = new Intl.Collator('zh-Hans-u-co-pinyin');
  } catch {
    collatorCache = null;
  }
  return collatorCache;
}

/** 单字的声母（大写）。非汉字（标点、数字、拉丁字母）返回空串。 */
function initialOf(char: string): string {
  const collator = pinyinCollator();
  if (collator === null) return '';
  if (!/\p{Script=Han}/u.test(char)) return '';
  let letter = '?';
  let low = 0;
  let high = PINYIN_INITIAL_BOUNDARIES.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const boundary = PINYIN_INITIAL_BOUNDARIES[mid];
    if (boundary === undefined) break;
    if (collator.compare(char, boundary[0]) >= 0) {
      letter = boundary[1];
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return letter === '?' ? '' : letter;
}

const initialCache = new Map<string, string>();

/** 一段文本的拼音首字母串（大写，只保留汉字）。结果按文本缓存。 */
export function pinyinInitials(text: string): string {
  const cached = initialCache.get(text);
  if (cached !== undefined) return cached;
  let out = '';
  for (const char of text) out += initialOf(char);
  initialCache.set(text, out);
  return out;
}

/**
 * 首字母匹配：查询是纯字母时，把它当成「声母串」再匹配一次。
 *
 * 只从主文本派生（副标注里的章节名不值得为它建索引），也不产出加亮区间 ——
 * 首字母命中的位置在中文原文里没有对应字符，硬标会标错看起来像 bug。
 */
function matchInitials(text: string, token: string): FuzzyMatch | null {
  if (!/^[a-z]+$/i.test(token)) return null;
  const initials = pinyinInitials(text);
  if (initials.length === 0) return null;
  const match = matchToken(initials, token);
  if (match === null) return null;
  return { score: match.score * INITIALS_WEIGHT, ranges: [] };
}

/**
 * 单个词元的匹配。
 *
 * 返回 `null` 表示没命中 —— 调用方据此判断「这个条目不进结果集」。
 */
function matchToken(text: string, token: string): FuzzyMatch | null {
  const haystack = text.toLowerCase();
  const needle = token.toLowerCase();
  if (needle.length === 0) return null;

  const at = haystack.indexOf(needle);
  if (at >= 0) {
    const base =
      haystack === needle
        ? SCORE_EXACT
        : at === 0
          ? SCORE_PREFIX
          : isWordStart(haystack, at)
            ? SCORE_WORD_START
            : SCORE_SUBSTRING;
    return {
      score: base - LENGTH_PENALTY * haystack.length - at,
      ranges: [[at, at + needle.length]],
    };
  }

  /* 子序列：字符按顺序出现但不连续。中文里「卡化」能命中「卡诺图化简」——
     这是拼音输入法用户最容易敲出来的形状（首字 + 尾字）。 */
  const ranges: Array<[number, number]> = [];
  let cursor = 0;
  let previous = -1;
  let gaps = 0;
  for (const ch of needle) {
    const found = haystack.indexOf(ch, cursor);
    if (found < 0) return null;
    if (previous >= 0) gaps += found - previous - 1;
    ranges.push([found, found + 1]);
    previous = found;
    cursor = found + 1;
  }
  return {
    score: SCORE_SUBSEQUENCE - GAP_PENALTY * gaps - LENGTH_PENALTY * haystack.length,
    ranges,
  };
}

/**
 * 整条查询的匹配。
 *
 * 空格分隔的多个词是**且**关系，各自独立匹配主文本或副标注：「卡诺 逻辑」
 * 能命中（名字里有「卡诺」、章节名里有「逻辑」），「卡诺 模拟」不行。
 *
 * 空查询返回 `null` —— 空态不是「全都匹配」，它有自己的默认态（最近访问 +
 * 页面动作），由调用方决定。
 */
export function fuzzyMatch(target: FuzzyTarget, query: string): FuzzyMatch | null {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  let total = 0;
  const ranges: Array<[number, number]> = [];

  for (const token of tokens) {
    const primary = matchToken(target.text, token);
    const hint = target.hint === undefined ? null : matchToken(target.hint, token);
    const initials = matchInitials(target.text, token);
    if (primary === null && hint === null && initials === null) return null;

    const primaryScore = primary === null ? Number.NEGATIVE_INFINITY : primary.score;
    const hintScore = hint === null ? Number.NEGATIVE_INFINITY : hint.score * HINT_WEIGHT;
    const initialsScore =
      initials === null ? Number.NEGATIVE_INFINITY : initials.score;
    total += Math.max(primaryScore, hintScore, initialsScore);

    /* 加亮只标主文本里的命中：副标注那一行是灰色小字，标了也读不出来，
       反而让结果行看起来更乱。 */
    if (primary !== null) ranges.push(...primary.ranges);
  }

  return { score: total, ranges };
}

export interface Ranked<T> {
  item: T;
  score: number;
  ranges: Array<[number, number]>;
}

/**
 * 过滤 + 排序。
 *
 * 排序是**稳定**的：同分时保持输入顺序（调用方按「知识点 → 页面」拼输入，
 * 于是同分时知识点在前）。同分且同长度时用原始下标兜底，避免 `Array.sort`
 * 的实现差异让结果在两次运行间跳动。
 */
export function fuzzyRank<T>(
  items: readonly T[],
  query: string,
  toTarget: (item: T) => FuzzyTarget,
): Array<Ranked<T>> {
  const scored: Array<Ranked<T> & { index: number; length: number }> = [];

  items.forEach((item, index) => {
    const target = toTarget(item);
    const match = fuzzyMatch(target, query);
    if (match === null) return;
    scored.push({
      item,
      index,
      length: target.text.length,
      score: match.score,
      ranges: match.ranges,
    });
  });

  scored.sort((a, b) => b.score - a.score || a.length - b.length || a.index - b.index);

  return scored.map(({ item, score, ranges }) => ({ item, score, ranges }));
}
