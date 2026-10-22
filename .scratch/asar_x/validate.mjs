import fs from 'node:fs';
import zlib from 'node:zlib';
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session';
import { assertReleasedV4Relationships, assertV4RowAdmission } from '@deepseek-ai/dsh-session-format-v3-to-v4';

const SRC = 'C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/session-55c776d2-6df9-450c-abcf-db3fe6001ef9/session.v4.jsonl.zstd';
const MAGIC = 4247762216;
function frameEnd(buf, start) {
  let o = start;
  if (buf.readUInt32LE(o) !== MAGIC) throw new Error('bad magic');
  o += 4;
  const d = buf.readUInt8(o); o += 1;
  const cs = d >>> 6, ss = (d & 32) !== 0, ck = (d & 4) !== 0, df = d & 3;
  const dict = df === 3 ? 4 : df;
  const csb = cs === 0 ? (ss ? 1 : 0) : (1 << cs);
  o += (ss ? 0 : 1) + dict + csb;
  for (;;) { const bh = buf.readUIntLE(o, 3); o += 3; const last = bh & 1, type = (bh >>> 1) & 3, size = bh >>> 3; o += type === 1 ? 1 : size; if (last) break; }
  if (ck) o += 4;
  return o;
}
const buf = fs.readFileSync(SRC);
let o = 0; const rows = [];
while (o < buf.length) { const e = frameEnd(buf, o); const t = zlib.zstdDecompressSync(buf.subarray(o, e)).toString('utf8'); for (const p of t.slice(0, -1).split('\n')) rows.push(JSON.parse(p)); o = e; }
console.log('rows=' + rows.length + '  knownTypes=' + KNOWN_SESSION_EVENT_TYPES.size);

const [headerRow, ...events] = rows;
const header = { id: headerRow.id, createdAt: headerRow.createdAt, isSeeded: headerRow.isSeeded === true, origin: headerRow.origin, parentSession: headerRow.parentSession };
const artifact = { header, events, inheritedEventCount: 0 };

let admission = 0;
for (const row of rows) { try { assertV4RowAdmission(row, KNOWN_SESSION_EVENT_TYPES); } catch (e) { admission++; if (admission < 4) console.log('ADMISSION FAIL seq=' + row.seq + ' ' + row.type + ': ' + e.message); } }
console.log('admission failures=' + admission);

try {
  assertReleasedV4Relationships(artifact, KNOWN_SESSION_EVENT_TYPES);
  console.log('RELATIONSHIPS: PASS (no throw)');
} catch (e) {
  console.log('RELATIONSHIPS: FAIL ' + e.constructor.name + ': ' + e.message);
}
