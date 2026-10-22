
import fs from 'node:fs';
import { decodeBuffer } from './lib_log.mjs';
const p = 'C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/ac78d58f-2746-4c68-baf8-5779c8c1b41e/session.v4.jsonl.zstd';
const buf = fs.readFileSync(p);
const dec = decodeBuffer(buf);
const rows = dec.rows.map(r => typeof r === 'string' ? JSON.parse(r) : r);
console.log('rows', rows.length, 'last type', rows[rows.length-1].type);
const kinds = {};
const samples = new Map();
for (const r of rows) {
  if (r.type !== 'user/message') continue;
  const src = r.data?.source?.kind ?? 'user';
  kinds[src] = (kinds[src] || 0) + 1;
  const t = (r.data?.content || []).map(c => c.text || '').join(' ');
  if (src !== 'user' && t) {
    const key = src + ' :: ' + t.slice(0, 60);
    samples.set(key, (samples.get(key) || 0) + 1);
  }
}
console.log('user msg kinds', JSON.stringify(kinds));
const arr = [...samples.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 12);
for (const [k, c] of arr) console.log(c, k);
