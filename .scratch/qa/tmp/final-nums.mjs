/**
 * t63 报数用：从 `apps/web/src/theme/tokens.ts` 读真源，算关卡页实际渲染的
 * (前景, 背景) 对，输出「对数 / 最差值 / 判定」。与 zz-level-theme 里从 DOM
 * 取色的那条探针互为交叉验证（那条验的是浏览器真的把 token 应用上了）。
 */
import { readFileSync } from 'node:fs';

const src = readFileSync('apps/web/src/theme/tokens.ts', 'utf8');

function grab(name) {
  const start = src.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`找不到 ${name}`);
  const open = src.indexOf('{', start);
  const close = src.indexOf('\n};', open);
  const body = src.slice(open + 1, close);
  const out = {};
  for (const line of body.split('\n')) {
    // 键名有的带引号（`'bg-canvas'`）有的不带（`accent`），两种都要认。
    const m = line.match(/^\s*'?([a-zA-Z0-9-]+)'?:\s*'(#[0-9a-fA-F]{6})'/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const D = grab('darkPalette');
const L = grab('lightPalette');

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => lin(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
};

/** 关卡页上真实出现的配色对（键名按 theme.ts 的 Fluent 槽位映射回 --sm-* 键）。 */
const PAIRS = [
  ['关卡标题 text-primary / bg-canvas', 'text-primary', 'bg-canvas', 4.5],
  ['副标题 text-tertiary / bg-canvas', 'text-tertiary', 'bg-canvas', 4.5],
  ['段轨已完成字 text-secondary / bg-elevated', 'text-secondary', 'bg-elevated', 4.5],
  ['段轨跳过字 text-tertiary / bg-surface', 'text-tertiary', 'bg-surface', 4.5],
  ['段轨未开始字 text-tertiary / bg-surface', 'text-tertiary', 'bg-surface', 4.5],
  ['段轨 chip 描边 border-control / bg-elevated', 'border-control', 'bg-elevated', 3],
  ['段轨 chip 描边 border-control / bg-surface', 'border-control', 'bg-surface', 3],
  ['选项未选描边 option-idle-border / bg-surface', 'option-idle-border', 'bg-surface', 3],
  ['选项未选描边 option-idle-border / bg-canvas', 'option-idle-border', 'bg-canvas', 3],
  ['选项悬停字 text-primary / option-hover-bg', 'text-primary', 'option-hover-bg', 4.5],
  ['选项选中字 text-primary / option-selected-bg', 'text-primary', 'option-selected-bg', 4.5],
  ['选项选中描边 option-selected-border / bg-surface', 'option-selected-border', 'bg-surface', 3],
  ['答对反馈条边 success / success-soft', 'success', 'success-soft', 3],
  ['答对反馈条字 text-primary / success-soft', 'text-primary', 'success-soft', 4.5],
  ['答错反馈条边 warning / warning-soft', 'warning', 'warning-soft', 3],
  ['答错反馈条字 text-primary / warning-soft', 'text-primary', 'warning-soft', 4.5],
  ['待判反馈条边 border-control / bg-elevated', 'border-control', 'bg-elevated', 3],
  ['待判反馈条字 text-primary / bg-elevated', 'text-primary', 'bg-elevated', 4.5],
  ['证据卡描边 accent / bg-canvas', 'accent', 'bg-canvas', 3],
  ['证据卡链接字 accent / bg-canvas', 'accent', 'bg-canvas', 4.5],
  ['门控警示字 warning / bg-elevated', 'warning', 'bg-elevated', 4.5],
  ['掌握度条字 text-tertiary / bg-elevated', 'text-tertiary', 'bg-elevated', 4.5],
  ['小结统计值 text-primary / bg-surface', 'text-primary', 'bg-surface', 4.5],
  ['小结统计标签 text-tertiary / bg-surface', 'text-tertiary', 'bg-surface', 4.5],
];

const used = new Set();
for (const [, fg, bg] of PAIRS) {
  used.add(fg);
  used.add(bg);
}

const summary = {};
for (const [label, P] of [
  ['DARK', D],
  ['LIGHT', L],
]) {
  console.log(`\n===== ${label} =====`);
  let fails = 0;
  let worst = null;
  for (const [name, fg, bg, min] of PAIRS) {
    if (!P[fg] || !P[bg]) {
      console.log(`MISSING ${name} fg=${P[fg]} bg=${P[bg]}`);
      continue;
    }
    const r = ratio(P[fg], P[bg]);
    const ok = r >= min;
    if (!ok) fails += 1;
    const margin = r / min;
    if (worst === null || margin < worst.margin) worst = { margin, r, name, min, fg, bg };
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(46)} ${String(r).padStart(6)}  (>= ${min})  ${P[fg]} on ${P[bg]}`,
    );
  }
  console.log(`pairs=${PAIRS.length} fails=${fails} worst=${worst.r} [${worst.name}] (${worst.fg} on ${worst.bg}, min ${worst.min})`);
  summary[label] = { fails, worst: worst.r, worstName: worst.name };
}

console.log(`\n映射到的 --sm- 键数：${used.size} / ${Object.keys(D).length}`);
console.log(`用到的键：${[...used].sort().join(', ')}`);
console.log(`\nRESULT ${JSON.stringify(summary)}`);
