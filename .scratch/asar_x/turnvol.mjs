
import fs from 'node:fs';
import { decodeBuffer } from './lib_log.mjs';
const id = 'ac78d58f-2746-4c68-baf8-5779c8c1b41e';
const p = 'C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/' + id + '/session.v4.jsonl.zstd';
const st = fs.statSync(p);
console.log('mtime', new Date(st.mtimeMs).toISOString(), 'size', st.size, 'now', new Date().toISOString());
const rows = decodeBuffer(fs.readFileSync(p)).rows.map(r => typeof r === 'string' ? JSON.parse(r) : r);
const last = rows[rows.length-1];
console.log('last type', last.type, 'seq', last.seq, 'time', new Date(last.time || last.at || 0).toISOString());
// per-turn bytes (raw record length) for last 8 turns
const turns = rows.filter(r => r.type === 'turn/start').map(r => ({ seq: r.seq, n: r.data?.turn }));
const out = [];
for (let i = 0; i < turns.length; i++) {
  const from = turns[i].seq, to = i + 1 < turns.length ? turns[i+1].seq : Infinity;
  let bytes = 0, ev = 0;
  for (const r of rows) if (r.seq >= from && r.seq < to) { ev++; bytes += JSON.stringify(r).length; }
  out.push({ turn: turns[i].n, ev, kb: Math.round(bytes/1024) });
}
console.log('turns', JSON.stringify(out.slice(-10)));
