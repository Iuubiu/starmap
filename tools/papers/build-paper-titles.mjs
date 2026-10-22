/**
 * 把论文的标题与章节名整理成 `translate_titles.mjs` 要的输入格式。
 *
 * 输入：`content/papers/index.json`（101 条）
 * 输出：`.scratch/paper-titles.json` → `{ "<sourceId>": ["原文", ...] }`
 *
 * ## 为什么要按 sourceId 分组
 *
 * `translate_titles.mjs` 的输入形状是 `{sourceId: [title, ...]}`（它是为
 * 「15 本书、每本一个目录」写的）。论文这边复用同一个形状：一篇论文一个键，
 * 第一项是论文标题，后面是它的章节名。脚本内部会跨篇去重，所以
 * `Introduction` 这类高频章节只翻一次。
 *
 * ## 为什么要先清洗章节名
 *
 * PDF 抽出来的章节名有大量残句：`Results for Different Scintillators and`
 * （结尾悬空）、`INCH COUNTER`（被版面切成两半的 `... 3-INCH COUNTER`）。
 * 直接喂给翻译器会得到「用于不同闪烁体与的结果」这种垃圾。
 * 清洗规则见 `cleanSectionTitle()`。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const INDEX = path.join(ROOT, 'content', 'papers', 'index.json');
const OUT = path.join(ROOT, '.scratch', 'paper-titles.json');

/** 结尾悬空的虚词。PDF 版面把标题切在词中间时，最后剩的常是这些。 */
const TRAILING_STOPWORDS = new Set([
  'and', 'or', 'of', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'with',
  'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'that', 'which',
  'this', 'these', 'those', 'its', 'their', 'our', 'we', 'it',
]);

/**
 * 清洗一条章节名。返回 `{ text, truncated }`。
 *
 * 规则（从最安全到最激进）：
 * 1. 压空白、去首尾标点与编号。
 * 2. 去结尾悬空虚词（`... Scintillators and` → `... Scintillators`）。
 * 3. 全大写的标题转成 Title Case（`INCH COUNTER` → `Inch Counter`）——
 *    全大写是排版效果，不是语义；翻译器对全大写的术语匹配率更低。
 * 4. 单词数 < 2 且长度 < 6 的（`Introduction` 之外的单字）标记 `truncated`，
 *    调用方会用「第 N 节 + 首个实词」降级命名。
 *
 * 注意：**不**尝试还原被切断的单词（`obtainabl` → `obtainable`）。
 * 那需要词典或模型，而这里的目的是「让翻译器能认出术语」，不是修复原文。
 */
function cleanSectionTitle(raw) {
  let text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  text = text.replace(/^[\s.,;:·\-—–|]+/, '').replace(/[\s.,;:·\-—–|]+$/, '');
  // 去编号前缀（`1.2 Title` / `IV. Title`）
  text = text.replace(/^(?:\d+(?:\.\d+)*\.?|[IVXLC]+\.)\s+/, '');

  let truncated = false;
  for (;;) {
    const words = text.split(' ');
    if (words.length <= 1) break;
    const last = words[words.length - 1].toLowerCase().replace(/[^a-z]/g, '');
    if (!TRAILING_STOPWORDS.has(last)) break;
    text = words.slice(0, -1).join(' ');
    truncated = true;
  }

  // 全大写 → Title Case（保留 ≤4 字符的缩写：GEM / CMS / TPC / LHC）
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length > 3 && letters === letters.toUpperCase()) {
    text = text
      .toLowerCase()
      .split(' ')
      .map((word) =>
        word.length <= 4 && word === word.toUpperCase() ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1),
      )
      .join(' ');
  }

  const wordCount = text.split(' ').filter(Boolean).length;
  if (wordCount < 2 && text.replace(/[^A-Za-z]/g, '').length < 6) {
    truncated = true;
  }

  return { text, truncated };
}

function main() {
  const entries = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const perSource = {};
  let cleaned = 0;
  let flagged = 0;

  for (const entry of entries) {
    const titles = [];
    // 第一项是论文标题（index.json 里已经是补全过的完整标题）
    titles.push(entry.title);
    cleaned += 1;
    // 章节名从 index.json 拿不到（它只存了 leafCount），所以这里只处理标题。
    // 章节名由 Python 侧单独导出成 section-titles.json。
    perSource[entry.sourceId] = titles;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(perSource, null, 2)}\n`, 'utf8');
  console.log(`✓ ${Object.keys(perSource).length} 篇论文标题 → ${OUT}（清洗 ${cleaned} 条，标记 ${flagged} 条）`);
}

export { cleanSectionTitle };

if (process.argv[1] && process.argv[1].endsWith('build-paper-titles.mjs')) {
  main();
}
