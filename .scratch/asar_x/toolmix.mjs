
import fs from 'node:fs';
import { decodeBuffer } from './lib_log.mjs';
const out = {};
for (const id of ['ac78d58f-2746-4c68-baf8-5779c8c1b41e','d3a73459-946f-4e99-b91a-6cbd6c2fb2b1']) {
  const p = 'C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/' + id + '/session.v4.jsonl.zstd';
  const rows = decodeBuffer(fs.readFileSync(p)).rows.map(r => typeof r === 'string' ? JSON.parse(r) : r);
  const tools = {}; let turns = 0; let lastEnd = null;
  for (const r of rows) {
    if (r.type === 'tool/call') tools[r.data?.name] = (tools[r.data?.name]||0)+1;
    if (r.type === 'turn/end') { turns++; lastEnd = r.data?.reason ?? r.data?.status ?? 'unknown'; }
  }
  out[id.slice(0,8)] = { rows: rows.length, turns, lastEnd, tools };
}
console.log(JSON.stringify(out, null, 1).slice(0, 2500));
