import fs from 'node:fs';
import zlib from 'node:zlib';
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session';
import { assertReleasedV4Relationships, assertV4RowAdmission } from '@deepseek-ai/dsh-session-format-v3-to-v4';

const SRC = 'C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/session-55c776d2-6df9-450c-abcf-db3fe6001ef9/session.v4.jsonl.zstd';
const TMP = SRC + '.new';
const MAGIC = 4247762216;
const CHECKSUM = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } };
const MODE = process.argv.includes('--apply') ? (process.argv.includes('--renumber') ? 'renumber' : 'insert') : 'dry';
const GAP = 27813;
const SPLIT = 27814;

function frameEnd(buf, start) {
  let o = start;
  if (buf.readUInt32LE(o) !== MAGIC) throw new Error('bad magic at ' + start);
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
function decode(buf) {
  const frameLines = []; const rows = []; let o = 0;
  while (o < buf.length) { const e = frameEnd(buf, o); const t = zlib.zstdDecompressSync(buf.subarray(o, e)).toString('utf8'); const lines = t.slice(0, -1).split('\n'); frameLines.push(lines.length); for (const p of lines) rows.push(JSON.stringify(JSON.parse(p))); o = e; }
  return { frameLines, rows };
}
function remapSeq(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= SPLIT) return v - 1;
  if (Array.isArray(v)) return v.map(remapSeq);
  if (v && typeof v === 'object') { const out = {}; for (const [k, x] of Object.entries(v)) out[k] = remapSeq(x); return out; }
  return v;
}
function checkSeqs(list, label) {
  let bad = 0;
  for (let i = 1; i < list.length; i++) { const r = JSON.parse(list[i]); if (r.seq !== i - 1) { if (bad < 3) console.log(label + ' SEQ BAD at row ' + i + ' seq=' + r.seq); bad++; } }
  console.log(label + ' rows=' + list.length + ' seqBreaks=' + bad + ' last=' + JSON.parse(list[list.length - 1]).type);
  return bad;
}
function validate(list, label) {
  const rows = list.map((l) => JSON.parse(l));
  const [h, ...events] = rows;
  const artifact = { header: { id: h.id, createdAt: h.createdAt, isSeeded: h.isSeeded === true, origin: h.origin, parentSession: h.parentSession }, events, inheritedEventCount: 0 };
  let adm = 0;
  for (const row of rows) { try { assertV4RowAdmission(row, KNOWN_SESSION_EVENT_TYPES); } catch (e) { adm++; if (adm < 3) console.log(label + ' ADMISSION FAIL seq=' + row.seq + ' ' + row.type + ': ' + e.message); } }
  let rel = 'PASS';
  try { assertReleasedV4Relationships(artifact, KNOWN_SESSION_EVENT_TYPES); } catch (e) { rel = 'FAIL ' + e.constructor.name + ': ' + e.message; }
  console.log(label + ' admission=' + adm + ' relationships=' + rel);
  return adm === 0 && rel === 'PASS';
}

const st0 = fs.statSync(SRC);
const buf = fs.readFileSync(SRC);
const { frameLines, rows } = decode(buf);
console.log('src bytes=' + buf.length + ' mtime=' + st0.mtime.toISOString() + ' rows=' + rows.length + ' frames=' + frameLines.length);
const p12 = JSON.parse(rows[12 + GAP - 12 - 1] ?? '{}');
console.log('row with seq 27812: ' + rows[SPLIT - 1].slice(0, 200));
console.log('row with seq 27814: ' + rows[SPLIT].slice(0, 200));

let list;
if (MODE === 'renumber') {
  const out = rows.slice(0, SPLIT);
  for (let i = SPLIT; i < rows.length; i++) {
    const r = JSON.parse(rows[i]);
    const copy = {};
    for (const [k, v] of Object.entries(r)) copy[k] = /seq/i.test(k) ? remapSeq(v) : v;
    out.push(JSON.stringify(copy));
  }
  list = out;
} else {
  const prev = JSON.parse(rows[SPLIT - 1]);
  const next = JSON.parse(rows[SPLIT]);
  const t = Math.min(next.time, Math.max(prev.time + 1, Math.floor((prev.time + next.time) / 2)));
  const synthetic = { type: 'model/selection', seq: GAP, time: t, data: { provider: next.data.provider, model: next.data.model } };
  list = [...rows.slice(0, SPLIT), JSON.stringify(synthetic), ...rows.slice(SPLIT)];
  console.log('synthetic: ' + JSON.stringify(synthetic));
}

const seqBad = checkSeqs(list, 'NEW');
const ok = validate(list, 'NEW');

const chunks = []; let idx = 0;
for (const n of frameLines) { const part = list.slice(idx, idx + n).join('\n') + '\n'; chunks.push(zlib.zstdCompressSync(Buffer.from(part, 'utf8'), CHECKSUM)); idx += n; }
while (idx < list.length) { chunks.push(zlib.zstdCompressSync(Buffer.from(list[idx] + '\n', 'utf8'), CHECKSUM)); idx++; }
const out = Buffer.concat(chunks);
const re = decode(out);
console.log('out bytes=' + out.length + ' frames=' + chunks.length + ' firstFrameLines=' + re.frameLines[0] + ' lines=' + re.rows.length + ' last=' + JSON.parse(re.rows[re.rows.length - 1]).type);
console.log('selfcheck seqBreaks=' + checkSeqs(re.rows, 'SELF'));

if (MODE === 'dry') { console.log('DRY: nothing written (mode insert)'); process.exit(0); }
if (!ok || seqBad || re.frameLines[0] !== 1) { console.log('ABORT: validation failed'); process.exit(3); }
const st1 = fs.statSync(SRC);
if (st1.size !== buf.length || st1.mtimeMs !== st0.mtimeMs) { console.log('ABORT: log changed during build'); process.exit(2); }
fs.writeFileSync(TMP, out);
fs.copyFileSync(TMP, SRC);
fs.unlinkSync(TMP);
console.log('APPLIED mode=' + MODE + ' bytes=' + fs.statSync(SRC).size);
