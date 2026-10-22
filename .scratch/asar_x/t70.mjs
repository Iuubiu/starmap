import fs from 'node:fs';
import { decodeBuffer, msgOf } from './lib_log.mjs';
const SRC = 'C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/session-55c776d2-6df9-450c-abcf-db3fe6001ef9/session.v4.jsonl.zstd';
const { rows } = decodeBuffer(fs.readFileSync(SRC));
const p = rows.map((l) => JSON.parse(l));
const starts = p.filter((r) => r.type === 'turn/start');
const turnOf = (seq) => { let t = 0; for (const s of starts) { if (s.seq <= seq) t = s.data.turn; else break; } return t; };
const byTurn = {};
for (const r of p) {
  const t = turnOf(r.seq); const b = (byTurn[t] = byTurn[t] || { n: 0, ev: 0, types: {} });
  b.ev++; b.types[r.type] = (b.types[r.type] || 0) + 1;
}
for (const t of [68, 69, 70, 71]) console.log('turn ' + t + ' events=' + byTurn[t].ev + ' ' + JSON.stringify(byTurn[t].types));
// sizes inside turn 70
const sz = [];
for (const r of p) {
  if (turnOf(r.seq) !== 70) continue;
  const raw = JSON.stringify(r.data || {});
  sz.push({ seq: r.seq, type: r.type, kb: Math.round(raw.length / 1024) });
}
sz.sort((a, b) => b.kb - a.kb);
console.log('turn70 top events by raw data size:');
for (const x of sz.slice(0, 12)) console.log('  ' + JSON.stringify(x));
console.log('turn70 raw data total=' + (sz.reduce((s, x) => s + x.kb, 0)) + 'KB');
const total = p.reduce((s, r) => s + JSON.stringify(r.data || {}).length, 0);
console.log('whole log data total=' + (total / 1024 / 1024).toFixed(2) + 'MB');
