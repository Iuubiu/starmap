import fs from 'node:fs';
import { decodeBuffer } from './lib_log.mjs';
const SRC = 'C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/session-55c776d2-6df9-450c-abcf-db3fe6001ef9/session.v4.jsonl.zstd';
const { rows } = decodeBuffer(fs.readFileSync(SRC));
const p = rows.map((l) => JSON.parse(l));
for (let i = 1; i < p.length; i++) {
  if (p[i].seq !== p[i - 1].seq + 1) {
    console.log('GAP at index ' + i + ': ' + p[i - 1].seq + ' (' + p[i - 1].type + ') -> ' + p[i].seq + ' (' + p[i].type + ')  missing=' + (p[i].seq - p[i - 1].seq - 1));
    console.log('  prev kind/data: ' + JSON.stringify(p[i - 1].data || {}).slice(0, 200));
    console.log('  next kind/data: ' + JSON.stringify(p[i].data || {}).slice(0, 200));
  }
}
console.log('total rows=' + p.length + ' first seq=' + p[0].seq + ' last seq=' + p[p.length - 1].seq);
