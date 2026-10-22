import io, re

p = 'skills/web-design-engineer/references/contrast-check.mjs'
s = io.open(p, encoding='utf-8').read()

# 1) 替换 docblock 里「不读运行时 token」那段
old_doc = """ * 它**不读** `apps/web/src/theme/` 的运行时 token：本文件是规范侧的真源，
 * 与实现侧的一致性由「实现侧必须抄同一组值」这条约定 + 人工评审保证。
 * 之所以不共享一份数据，是因为本 skill 要能在 t58 落地之前就独立运行
 * （先定规范、后写实现），也要能在实现被改坏时独立报警（规范不跟着漂）。
"""
new_doc = """ * ## 它读的是实现侧的 token，不是手抄的一份
 *
 * 2026-10-22 之前这里抄着一份自己的 palette，靠「实现侧必须抄同一组值」
 * 这条口头约定保持一致。结果是：`tokens.ts` 改了 47/52 个键（深色）、
 * 39/52（亮色），探针还在验 t57 时代的旧值，`TOTAL FAILURES: 0` 全绿 ——
 * 假绿比红更危险，因为没人会去查一条从没被写的断言。
 *
 * 现在 `palettes()` 直接解析 `apps/web/src/theme/tokens.ts` 的
 * `darkPalette` / `lightPalette`，并在表头打印 `palette source: <路径> (sha…)`。
 * 漂移在结构上不可能再发生：探针与实现是同一份数据。
 *
 * 代价：本文件不能再脱离仓库单独运行（要能找到 `tokens.ts`）。这是**故意**
 * 的取舍 —— 一个验不了实现的探针，跑得再独立也没有价值。
"""
assert s.count(old_doc) == 1, 'doc block not found'
s = s.replace(old_doc, new_doc)

# 2) 找到 DARK/LIGHT 定义块并整体替换
start = s.index('/** 深色（默认）。 */\nconst DARK = {')
end = s.index('// ---------------------------------------------------------------------------\n// WCAG 2.1 相对亮度与对比度')

loader = '''// ---------------------------------------------------------------------------
// palette 真源：直接解析实现侧的 tokens.ts
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根：本文件在 `skills/web-design-engineer/references/` 下。 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const TOKENS_TS = resolve(REPO_ROOT, 'apps/web/src/theme/tokens.ts');

/**
 * 从一个 `const xxxPalette = { ... }` 对象字面量里抽出 `键: '值'` 对。
 *
 * 用大括号配平来找对象边界，而不是正则跨行 —— palette 里有嵌套的注释与
 * 折行，非贪婪正则会在第一个 `}` 处截断。
 *
 * 键可能带引号（`'warning-soft'`）也可能不带（`warning`），两种都要认。
 * 这个细节踩过：只认带引号的写法时，`warning` / `success` / `danger`
 * 这几个短键会被静默跳过，于是「语义色对 soft 底」整组规则全部消失，
 * 而输出仍然是 `all pass: true`。
 */
function parsePalette(source, constName) {
  const at = source.indexOf(`const ${constName}`);
  if (at < 0) throw new Error(`tokens.ts 里找不到 ${constName}`);
  const open = source.indexOf('{', at);
  let depth = 0;
  let i = open;
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = source.slice(open + 1, i);
  const out = {};
  for (const m of body.matchAll(/'?([a-z0-9-]+)'?:\s*'([^']+)'/g)) out[m[1]] = m[2];
  return out;
}

function loadPalettes() {
  const source = readFileSync(TOKENS_TS, 'utf8');
  const sha = createHash('sha256').update(source).digest('hex').slice(0, 12);
  return {
    sha,
    dark: parsePalette(source, 'darkPalette'),
    light: parsePalette(source, 'lightPalette'),
  };
}

const PALETTES = loadPalettes();
const DARK = PALETTES.dark;
const LIGHT = PALETTES.light;

'''

s = s[:start] + loader + s[end:]

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('patched')
