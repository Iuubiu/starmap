import fs from 'node:fs';
import { decodeBuffer, msgOf } from './lib_log.mjs';
const SRC = 'C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/session-55c776d2-6df9-450c-abcf-db3fe6001ef9/session.v4.jsonl.zstd';
const { rows } = decodeBuffer(fs.readFileSync(SRC));
const parsed = rows.map((l) => JSON.parse(l));
const from = parsed.findIndex((r) => r.type === 'turn/start' && r.data.turn === 69);
console.log('turn69 start row=' + from + ' seq=' + (from >= 0 ? parsed[from].seq : -1));
for (const r of parsed.slice(Math.max(0, from - 6), from + 4)) {
  if (r.type === 'user/message') {
    const t = (r.data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ').slice(0, 160);
    console.log(r.seq + ' user/' + (r.data.source && r.data.source.kind) + ' :: ' + JSON.stringify(t));
  } else console.log(r.seq + ' ' + r.type + (r.type === 'turn/start' ? ' turn=' + r.data.turn : ''));
}
