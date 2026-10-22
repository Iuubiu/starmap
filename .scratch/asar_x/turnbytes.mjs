import fs from 'node:fs';
import { decodeBuffer, msgOf } from './lib_log.mjs';
const SRC = 'C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/session-55c776d2-6df9-450c-abcf-db3fe6001ef9/session.v4.jsonl.zstd';
const { rows } = decodeBuffer(fs.readFileSync(SRC));
const p = rows.map((l) => JSON.parse(l));
const starts = p.filter((r) => r.type === 'turn/start');
const turnOf = (seq) => { let t = 0; for (const s of starts) { if (s.seq <= seq) t = s.data.turn; else break; } return t; };
const chars = {};
for (const r of p) {
  const t = turnOf(r.seq);
  let n = 0;
  if (r.type === 'assistant/message') { const m = msgOf(r); for (const b of m.content || []) n += (b.text || '').length + (typeof b.arguments === 'string' ? b.arguments.length : JSON.stringify(b.arguments || {}).length); }
  else if (r.type === 'tool/result') { const m = msgOf(r); for (const b of m.content || []) n += (b.text || '').length; }
  else if (r.type === 'user/message') { const c = (r.data && r.data.content) || []; for (const b of c) n += (b.text || '').length; }
  chars[t] = (chars[t] || 0) + n;
}
const ent = Object.entries(chars).map(([k, v]) => [Number(k), v]).sort((a, b) => a[0] - b[0]);
let run = 0;
for (const [t, v] of ent) { run += v; console.log('turn ' + t + ' ' + (v / 1024).toFixed(0) + 'KB cumulative=' + (run / 1024).toFixed(0) + 'KB'); }
const sel = p.filter((r) => r.type === 'model/selection').slice(-3);
for (const s of sel) console.log('model/selection ' + JSON.stringify(s.data).slice(0, 300));
