/**
 * target_hint → 真实元素 的确定性解析器。
 *
 * 这里**没有模型**，全部是规则。规则的选择标准只有一条：人类读到 hint
 * 时能唯一确定目标，解析器也应该能；解析器做不到时，要么是 hint 写得烂
 * （模型能力问题，记下来），要么是界面结构对语言描述不友好（**产品问题**）。
 * 后者正是我们要找的东西，所以解析失败必须记录，绝不能重试或模糊匹配蒙对。
 *
 * 支持的说法（来自三个 persona 的实际台词）：
 *  - 引用原文：「数据库」「能量分辨率」
 *  - 序号：第一个、第二张、第 3 个
 *  - 方位：上面/顶部、下面/底部、中间、左边、右边
 *  - 角色词：按钮、输入框、标签、卡片、链接
 */

export interface TargetCandidate {
  index: number;
  role: string;
  /** accessible name（已 trim）。空名元素不进入候选，因为它们本来就不该被指。 */
  name: string;
  tag: string;
  x: number;
  y: number;
  width: number;
  height: number;
  disabled: boolean;
  visible: boolean;
}

export type ResolveResult =
  | { ok: true; target: TargetCandidate; score: number; reason: string }
  | { ok: false; reason: string; scored: Array<{ candidate: TargetCandidate; score: number }> };

const ORDINALS: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
};

/** 角色词 → 候选的 role/tag 过滤。只用于加分，不强制。 */
const ROLE_WORDS: Array<{ words: string[]; match: (c: TargetCandidate) => boolean }> = [
  { words: ['按钮'], match: (c) => c.role === 'button' || c.tag === 'button' },
  { words: ['输入框', '输入栏', '文本框'], match: (c) => c.tag === 'input' || c.tag === 'textarea' || c.role === 'textbox' },
  { words: ['标签页', '标签', '选项卡'], match: (c) => c.role === 'tab' },
  { words: ['链接', '超链接'], match: (c) => c.role === 'link' || c.tag === 'a' },
  { words: ['卡片'], match: (c) => c.role === 'button' || c.role === 'link' },
];

const TOP_WORDS = ['上面', '上方', '顶部', '顶栏', '最上', '上边'];
const BOTTOM_WORDS = ['下面', '下方', '底部', '最下', '下边', '底下'];
const MIDDLE_WORDS = ['中间', '中部', '中央'];
const LEFT_WORDS = ['左边', '左侧', '最左'];
const RIGHT_WORDS = ['右边', '右侧', '最右'];

/**
 * 允许点击所需的最低分。
 *
 * 分数来自两类证据，权重差得很大：
 *  - 指认（这个名字就是它）：引号命中 3–6 分、无引号名字命中 2/4 分；
 *  - 缩小范围（在这批里找）：角色词 1 分、方位词 ±1~2 分。
 * 3 分这一档的用意是：只有"名字命中"或"引号命中"才够，光靠「按钮」两个字
 * 点不动任何东西。这条阈值是 locator_failure 可信度的地基 —— 松一点，
 * 我们就会在"元素根本不存在"时报告一次成功的点击。
 */
const MIN_IDENTIFYING_SCORE = 3;

function extractQuoted(hint: string): string[] {
  const found: string[] = [];
  for (const pattern of [/「([^」]+)」/g, /『([^』]+)』/g, /"([^"]+)"/g, /'([^']+)'/g, /“([^”]+)”/g, /‘([^’]+)’/g]) {
    for (const match of hint.matchAll(pattern)) {
      const value = match[1]?.trim();
      if (value && value.length > 0) found.push(value);
    }
  }
  return found;
}

function extractOrdinal(hint: string): number | null {
  const match = /第\s*([0-9一二两三四五六七八九十]+)\s*(?:个|张|条|项|块|列|行|页|位)?/.exec(hint);
  if (!match?.[1]) return null;
  return ORDINALS[match[1]] ?? null;
}

function regionOf(candidate: TargetCandidate, viewportHeight: number): 'top' | 'middle' | 'bottom' {
  const center = candidate.y + candidate.height / 2;
  if (center < viewportHeight / 3) return 'top';
  if (center > (viewportHeight * 2) / 3) return 'bottom';
  return 'middle';
}

function sideOf(candidate: TargetCandidate, viewportWidth: number): 'left' | 'middle' | 'right' {
  const center = candidate.x + candidate.width / 2;
  if (center < viewportWidth / 3) return 'left';
  if (center > (viewportWidth * 2) / 3) return 'right';
  return 'middle';
}

export interface ResolveOptions {
  viewportWidth: number;
  viewportHeight: number;
}

/**
 * 打分式解析。分数必须**严格高于第二名**才算命中 —— 打平就报歧义。
 *
 * 为什么不用"取最高分"：如果两个候选同分，取第一个等于随机选择，而随机
 * 选择会让"点错了"看起来像"产品状态不对"，污染后面所有阶段的数据。
 * 宁可报一条 locator_failure（我们知道原因），也不要悄悄点错。
 */
export function resolveTarget(hint: string, candidates: readonly TargetCandidate[], options: ResolveOptions): ResolveResult {
  const usable = candidates.filter((candidate) => candidate.name.length > 0 && candidate.visible);
  const trimmed = hint.trim();

  if (usable.length === 0) {
    return { ok: false, reason: '页面上没有带可访问名的可见元素，无法解析任何 hint', scored: [] };
  }
  if (trimmed.length === 0) {
    return { ok: false, reason: 'hint 为空', scored: [] };
  }

  const quoted = extractQuoted(trimmed);
  const ordinal = extractOrdinal(trimmed);
  const wantsTop = TOP_WORDS.some((word) => trimmed.includes(word));
  const wantsBottom = BOTTOM_WORDS.some((word) => trimmed.includes(word));
  const wantsMiddle = MIDDLE_WORDS.some((word) => trimmed.includes(word));
  const wantsLeft = LEFT_WORDS.some((word) => trimmed.includes(word));
  const wantsRight = RIGHT_WORDS.some((word) => trimmed.includes(word));

  const scored = usable.map((candidate) => {
    let score = 0;
    const name = candidate.name;

    /* ① 引用原文：最高权重。名字完全等于引用 → 6；包含引用 → 5。
       这是最可靠的一类，因为模型通常直接抄了界面上的字。 */
    for (const quote of quoted) {
      if (name === quote) score += 6;
      else if (name.includes(quote)) score += 5;
      else if (quote.includes(name) && name.length >= 2) score += 3;
    }

    /* ② hint 里直接出现了元素名（无引号）。要求名字 ≥2 字，避免"的"这类
       单字垃圾匹配。名字越长命中越可信。 */
    if (quoted.length === 0) {
      if (trimmed.includes(name) && name.length >= 2) {
        score += name.length >= 4 ? 4 : 2;
      }
    }

    /* ③ 角色词：命中的角色加 1。只做微调，不足以单独决定。 */
    for (const rule of ROLE_WORDS) {
      if (rule.words.some((word) => trimmed.includes(word)) && rule.match(candidate)) {
        score += 1;
        break;
      }
    }

    /* ④ 方位词：命中加 2，反向命中扣 1（说了"上面"就排除底部元素）。 */
    const region = regionOf(candidate, options.viewportHeight);
    const side = sideOf(candidate, options.viewportWidth);
    if (wantsTop) score += region === 'top' ? 2 : region === 'bottom' ? -1 : 0;
    if (wantsBottom) score += region === 'bottom' ? 2 : region === 'top' ? -1 : 0;
    if (wantsMiddle && !wantsTop && !wantsBottom) score += region === 'middle' ? 2 : 0;
    if (wantsLeft) score += side === 'left' ? 2 : side === 'right' ? -1 : 0;
    if (wantsRight) score += side === 'right' ? 2 : side === 'left' ? -1 : 0;

    /* ⑤ 不可用元素降权：disabled 的按钮点不动，不该赢过可点的同类。 */
    if (candidate.disabled) score -= 2;

    return { candidate, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    /* 同分时按屏幕顺序（上→下、左→右）排，只为让输出稳定，不改变判定。 */
    if (a.candidate.y !== b.candidate.y) return a.candidate.y - b.candidate.y;
    return a.candidate.x - b.candidate.x;
  });

  const best = scored[0];
  const second = scored[1];

  /* 序号语义：先按分数排好序，再取第 N 个。序号本身**就是**消歧手段 ——
     「第一张卡片」在五张同分卡片里是有唯一答案的，报歧义等于把用户说得很
     清楚的话当成没说。所以序号分支不查同分，只查越界。 */
  if (ordinal !== null) {
    const positive = scored.filter((entry) => entry.score > 0);
    const picked = positive[ordinal - 1];
    if (!picked) {
      return {
        ok: false,
        reason: `hint 要求第 ${ordinal} 个，但只有 ${positive.length} 个候选分数为正`,
        scored,
      };
    }
    return { ok: true, target: picked.candidate, score: picked.score, reason: `按序号取第 ${ordinal} 个（共 ${positive.length} 个候选）` };
  }

  /* 没有序号时，必须拿到"指认级"的证据才允许点击。
     角色词（「按钮」「卡片」）和方位词（「上面」）只是**缩小范围**，不是指认：
     一句「那个不存在的按钮」会让页面上每个按钮都拿到 1 分，若就此取最高分，
     我们会把"根本没这个元素"误判成"点到了某个按钮"，然后把后续所有观测污染掉。
     指认级证据 = 名字命中（≥2 分）或引号命中（≥3 分）。 */
  if (!best || best.score < MIN_IDENTIFYING_SCORE) {
    return {
      ok: false,
      reason: `hint「${trimmed}」没有匹配到任何元素（最高分 ${best?.score ?? 0}，指认需要 ≥${MIN_IDENTIFYING_SCORE} 分；角色词与方位词只能缩小范围）`,
      scored,
    };
  }

  if (second && second.score === best.score) {
    return {
      ok: false,
      reason: `「${trimmed}」同时匹配到多个元素（同分 ${best.score}：${best.candidate.name} / ${second.candidate.name}），无法确定点击哪一个`,
      scored,
    };
  }

  return { ok: true, target: best.candidate, score: best.score, reason: `最高分 ${best.score}，次高 ${second?.score ?? 0}` };
}
