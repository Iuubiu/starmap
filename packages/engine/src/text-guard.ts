/**
 * 面向学习者的文本守卫：全中文（D10）与追问形态。
 *
 * 为什么放在 engine 而不是写进 controller：这两条都是**可被判定的规则**，
 * 不是「尽量做到」的约定。放在纯函数层，测试可以逐条断言；放在 HTTP 层，
 * 它们会退化成散落在各 controller 里的正则。
 *
 * 允许出现的英文（不是漏洞，是规格本身）：
 * - 代码标识符、表名列名、文件名（用反引号包起来，或本身是标识符形态）；
 * - 首次出现的术语注解：「能量分辨率（energy resolution）」；
 * - 数学/公式片段（`$...$` 与代码块）里的符号；
 * - 单位与型号：keV、MeV、Si(Li)、CR-RC、dB、FPGA 这类专有名词。
 *
 * 这些豁免都写进规则里，而不是「见到英文就判红」——否则正常的专业文本
 * 会被判成违规，检查本身会被关掉。
 */

/**
 * 英文词的切分方式。
 *
 * 这里刻意把连字符与数字**并入同一个 token**：`CR-110`、`AD9637` 是一整个
 * 型号，拆成 `CR-` + `110` 会让 `CR-` 变成一个「未加注的英文词」而误报。
 * 型号里有数字，所以按「含数字即豁免」放行；拆开就放行不掉了。
 */
const ENGLISH_WORD = /[A-Za-z][A-Za-z0-9]*(?:[-'][A-Za-z0-9]+)*/g;

/**
 * 白名单：核电子学与工程语境里常见的英文专名/单位/缩写。
 * 出现在正文里不算「未加注的英文」。全部小写比较。
 */
const ALLOWED_WORDS = new Set(
  [
    // 单位与量纲
    'kev', 'mev', 'ev', 'v', 'mv', 'uv', 'a', 'ma', 'ua', 'na', 'pa', 'ns', 'us', 'ms', 'ps',
    'hz', 'khz', 'mhz', 'ghz', 'db', 'k', 'c', 'f', 'h', 'w', 'mw', 'uw', 'cm', 'mm', 'um', 'nm',
    'kg', 'g', 's', 'ppm', 'rms', 'snr', 'enob', 'lsb', 'fwhm',
    // 器件与电路
    'si', 'ge', 'gaas', 'cdte', 'hgte', 'csi', 'nai', 'bgo', 'lyso', 'pmt', 'sipm', 'apd',
    'fet', 'mosfet', 'bjt', 'jfet', 'cmos', 'ttl', 'ecl', 'lvds', 'adc', 'dac', 'tia', 'opa',
    'fpga', 'asic', 'dsp', 'pll', 'dll', 'ldo', 'pcb', 'emi', 'esd',
    // 方法与术语缩写
    'cr', 'rc', 'sh', 'csa', 'tfa', 'bpf', 'fft', 'dft', 'mca', 'tac', 'tdc', 'qdc', 'cfd',
    'led', 'z', 'q', 'i', 'u', 'r', 'l', 'p', 'n', 'e', 'hpge',
  ].map((w) => w),
);

/** 去掉不应参与「中文覆盖」判定的片段：代码块、行内代码、LaTeX、括号注解。 */
function stripExempt(text: string): string {
  return (
    text
      // ```fenced code```
      .replace(/```[\s\S]*?```/g, ' ')
      // `inline code`
      .replace(/`[^`]*`/g, ' ')
      // $...$ 与 $$...$$
      .replace(/\$\$[\s\S]*?\$\$/g, ' ')
      .replace(/\$[^$]*\$/g, ' ')
      // 中文括号/英文括号里的注解：能量分辨率（energy resolution）
      .replace(/（[^）]*）/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
  );
}

export interface ChineseCheck {
  ok: boolean;
  /** 未加注英文的片段（去重、保持出现顺序），供 UI 标红与提示使用 */
  offenders: string[];
}

/**
 * 检查一段面向学习者的文本是否「中文为主」。
 *
 * 判定规则刻意宽松到只抓真问题：
 * - 允许白名单里的专名/单位；
 * - 允许以大写+小写混合的型号（例如 `CR-110`、`AD9637`）——它们在 stripExempt 后通常带连字符或数字；
 * - 只要找到**至少一个汉字**，且不出现白名单外的纯英文单词，就算通过。
 *
 * 全英文文本（一个汉字都没有）判为不通过：「This is a hint」这种回复
 * 学习者读不懂，必须重试。
 */
export function checkChinese(text: string): ChineseCheck {
  const stripped = stripExempt(text);
  const hasChinese = /[\u4e00-\u9fff]/.test(text);
  if (!hasChinese) {
    const offenders = uniqueMatches(stripped);
    return { ok: false, offenders: offenders.length > 0 ? offenders : [text.trim().slice(0, 40)] };
  }

  const offenders = uniqueMatches(stripped).filter((word) => {
    const lower = word.toLowerCase();
    if (ALLOWED_WORDS.has(lower)) return false;
    // 型号形态：全大写字母+数字，或含数字的混合串（AD9637 / CR-110 / 74HC161）
    if (/\d/.test(word)) return false;
    // 单个大写字母开头的两字母组合多半是符号/型号（Si、Ge 已在白名单）
    if (word.length <= 2) return false;
    return true;
  });

  return { ok: offenders.length === 0, offenders };
}

function uniqueMatches(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(ENGLISH_WORD)) {
    const word = match[0];
    if (seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

/**
 * `visibleResponse` 的形态校验：要么以问号结尾（追问），要么被显式标记为非追问。
 *
 * 规格原文是「结构化输出强制 `visibleResponse` 以 `?` 结尾」。但界面里
 * 「你已完成本章」这类陈述句也必须有位置出现 —— 所以真正的要求是
 * **不能有既不以问号结尾、又没被标记为非追问的回复**。那种回复通常是
 * 模型把内部推理漏到了展示层。
 */
export function checkProbeForm(
  visibleResponse: string,
  isProbe: boolean,
): { ok: boolean; reason: 'ok' | 'question_mark_missing' | 'marked_probe_without_question' } {
  const trimmed = visibleResponse.trim();
  const endsWithQuestion = /[?？]\s*$/.test(trimmed);

  if (isProbe && !endsWithQuestion) {
    return { ok: false, reason: 'marked_probe_without_question' };
  }
  if (!isProbe && !endsWithQuestion) {
    // 非追问形态允许陈述句：这是显式标记走通的路径
    return { ok: true, reason: 'ok' };
  }
  if (endsWithQuestion) {
    return { ok: true, reason: 'ok' };
  }
  return { ok: false, reason: 'question_mark_missing' };
}

/** 每轮最多问一个问题：数问号（中文问号与英文问号都算）。 */
export function countQuestions(text: string): number {
  const matches = text.match(/[?？]/g);
  return matches ? matches.length : 0;
}
