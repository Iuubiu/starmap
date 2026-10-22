import { readFileSync } from 'node:fs';
const src = readFileSync('apps/web/src/theme/tokens.ts', 'utf8');
function grab(name) {
  const i = src.indexOf(`const ${name}`); const open = src.indexOf('{', i);
  let d = 0, j = open; for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  const body = src.slice(open + 1, j); const out = {};
  for (const m of body.matchAll(/'?([a-z0-9-]+)'?:\s*'([^']+)'/g)) out[m[1]] = m[2];
  return out;
}
const P = { dark: grab('darkPalette'), light: grab('lightPalette') };
const hex = (h) => { const s = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const [r, g, b] = hex(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const cr = (a, b) => { const x = lum(a), y = lum(b); const hi = Math.max(x, y), lo = Math.min(x, y); return (hi + 0.05) / (lo + 0.05); };
const f = (n) => Math.round(n * 100) / 100;
const pairs = [
  ['accent', 'bg-selected'], ['accent', 'bg-surface'], ['accent', 'bg-canvas'], ['accent', 'bg-elevated'],
  ['accent', 'bg-hover'], ['accent', 'bg-sunken'],
  ['border-control', 'bg-selected'],
  ['text-tertiary', 'bg-selected'], ['text-tertiary', 'bg-hover'],
];
for (const [a, b] of pairs) {
  const r = [];
  for (const t of ['dark', 'light']) r.push(`${t} ${f(cr(P[t][a], P[t][b]))}`);
  console.log(`${a} / ${b}`.padEnd(34), r.join('   '));
}
