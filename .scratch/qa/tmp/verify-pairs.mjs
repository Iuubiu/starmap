import { readFileSync } from 'node:fs';

const src = readFileSync('apps/web/src/theme/tokens.ts', 'utf8');
function grab(name) {
  const i = src.indexOf(`const ${name}`);
  const open = src.indexOf('{', i);
  let depth = 0, j = open;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (!depth) break; } }
  const body = src.slice(open + 1, j);
  const out = {};
  for (const m of body.matchAll(/'?([a-z0-9-]+)'?:\s*'([^']+)'/g)) out[m[1]] = m[2];
  return out;
}
const D = grab('darkPalette'), L = grab('lightPalette');

const hex = (h) => { const s = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const [r, g, b] = hex(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const cr = (a, b) => { const x = lum(a), y = lum(b); const hi = Math.max(x, y), lo = Math.min(x, y); return (hi + 0.05) / (lo + 0.05); };
const f = (n) => Math.round(n * 100) / 100;

const BGS = ['bg-surface', 'bg-canvas', 'bg-elevated', 'bg-hover', 'bg-selected', 'bg-sunken'];
const rows = [];
function probe(label, fgKey, bgs, min) {
  for (const [tn, P] of [['dark', D], ['light', L]]) {
    for (const bg of bgs) {
      const fg = P[fgKey], b = P[bg];
      if (!fg || !b || !fg.startsWith('#') || !b.startsWith('#')) { rows.push([label, tn, bg, 'MISSING', min, 'FAIL']); continue; }
      const v = cr(fg, b);
      rows.push([label, tn, bg, f(v), min, v >= min ? 'ok' : 'FAIL']);
    }
  }
}

probe('border-control', 'border-control', BGS, 3);
probe('text-tertiary(skip)', 'text-tertiary', ['bg-surface', 'bg-canvas', 'bg-elevated'], 4.5);
probe('option-selected-border', 'option-selected-border', ['bg-surface', 'bg-canvas', 'bg-selected'], 3);
probe('accent-soft(CardView bar)', 'accent-soft', ['bg-canvas', 'bg-surface', 'bg-elevated'], 3);
probe('warning(wrong bar edge)', 'warning', ['warning-soft'], 3);
probe('success(correct bar edge)', 'success', ['success-soft'], 3);

let worst = { dark: Infinity, light: Infinity };
const fails = [];
for (const [label, tn, bg, v, min, st] of rows) {
  const line = `${st.padEnd(4)} ${tn.padEnd(5)} ${String(label).padEnd(26)} / ${bg.padEnd(13)} ${String(v).padStart(6)}  (>= ${min})`;
  console.log(line);
  if (st === 'FAIL') fails.push(line);
  else if (typeof v === 'number') worst[tn] = Math.min(worst[tn], v / min);
}
console.log('\nrules:', rows.length, ' failures:', fails.length);
console.log('worst-ratio dark:', f(worst.dark), ' light:', f(worst.light));
