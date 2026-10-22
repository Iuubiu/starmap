
import fs from 'node:fs';
import { decodeBuffer } from './lib_log.mjs';
const id = 'ac78d58f-2746-4c68-baf8-5779c8c1b41e';
const p = 'C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/' + id + '/session.v4.jsonl.zstd';
const rows = decodeBuffer(fs.readFileSync(p)).rows.map(r => typeof r === 'string' ? JSON.parse(r) : r);
const reasons = {};
let errSample = null;
for (const r of rows) {
  if (r.type === 'turn/end') { const k = JSON.stringify(r.data?.kind || r.data?.reason || r.data); reasons[k] = (reasons[k]||0)+1; }
  if (!errSample && r.type === 'turn/end' && JSON.stringify(r.data).includes('error')) errSample = JSON.stringify(r.data).slice(0, 300);
}
console.log('turn/end kinds', JSON.stringify(reasons));
console.log('err sample', errSample);
