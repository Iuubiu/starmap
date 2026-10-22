import fs from 'node:fs';
import { decodeBuffer, msgOf } from './lib_log.mjs';
const SRC = 'C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/session-55c776d2-6df9-450c-abcf-db3fe6001ef9/session.v4.jsonl.zstd';
const { rows } = decodeBuffer(fs.readFileSync(SRC));
const p = rows.map((l) => JSON.parse(l));
const tail = p.slice(-60);
for (const r of tail) {
  const d = r.data || {};
  let s = '';
  if (r.type === 'turn/end') s = JSON.stringify(d.reason).slice(0, 600);
  else if (r.type === 'turn/start') s = 'turn=' + d.turn;
  else if (/error|fail|retry|abort|interrupt/i.test(r.type)) s = JSON.stringify(d).slice(0, 600);
  if (s) console.log(r.seq + ' ' + r.type + ' ' + new Date(r.time).toISOString().slice(11, 19) + ' ' + s);
}
const errs = p.filter((r) => /error|fail/i.test(r.type)).slice(-6);
console.log('--- error-ish events (last 6) ---');
for (const r of errs) console.log(r.seq + ' ' + r.type + ' ' + JSON.stringify(r.data).slice(0, 700));
