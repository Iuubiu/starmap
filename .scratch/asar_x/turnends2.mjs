
import fs from 'node:fs';
import { decodeBuffer } from './lib_log.mjs';
for (const id of ['ac78d58f-2746-4c68-baf8-5779c8c1b41e','d3a73459-946f-4e99-b91a-6cbd6c2fb2b1','aaf9c910-0c13-4857-abc3-5d824bd0e801']) {
  const p = 'C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/' + id + '/session.v4.jsonl.zstd';
  const rows = decodeBuffer(fs.readFileSync(p)).rows.map(r => typeof r === 'string' ? JSON.parse(r) : r);
  console.log('===', id.slice(0,8), 'rows', rows.length, 'last', rows[rows.length-1].type, new Date(rows[rows.length-1].time||0).toISOString());
  for (const r of rows) {
    if (r.type !== 'turn/end') continue;
    const k = r.data?.kind;
    const msg = r.data?.error?.message ? String(r.data.error.message).replace(/\s+/g,' ').slice(0,90) : '';
    console.log('  ', new Date(r.time||0).toISOString().slice(5,19), k, msg);
  }
}
