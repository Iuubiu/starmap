import fs from 'node:fs';
import { decodeBuffer, encodeRows, scanFrames, visibleChars, writeAtomic, CHECKSUM } from './lib_log.mjs';
import zlib from 'node:zlib';
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session';
import { assertReleasedV4Relationships, assertV4RowAdmission } from '@deepseek-ai/dsh-session-format-v3-to-v4';

const SRC = 'C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/session-55c776d2-6df9-450c-abcf-db3fe6001ef9/session.v4.jsonl.zstd';
const BACKUP_DIR = 'D:/DeepSeek/starmap/.scratch/session-backup';
const LOG = 'D:/DeepSeek/starmap/.scratch/maintain.log';
const IDLE_MS = 3 * 60 * 1000;
const AUTO_FOLD = false; // billion-context 插件负责压缩，守护脚本只管日志结构
const VISIBLE_LIMIT = 3_000_000;
const KEEP_TURNS = 4;
const AUTO = process.argv.includes('--auto');
const notes = [];
const actions = [];
let needHuman = null;

function log(obj) { const line = JSON.stringify({ at: new Date().toISOString(), ...obj }); fs.appendFileSync(LOG, line + '\n'); console.log(line); }

const st = fs.statSync(SRC);
const idleMs = Date.now() - st.mtimeMs;
const buf = fs.readFileSync(SRC);
let { frameLines, rows, rest, badFrame } = decodeBuffer(buf);
notes.push('bytes=' + buf.length + ' frames=' + frameLines.length + ' rows=' + rows.length + ' rest=' + rest.length + ' badFrame=' + badFrame);

if (rows.length === 0) { console.log('STATUS=needhuman:rows=0'); process.exit(0); }

const parsed = rows.map((l) => JSON.parse(l));
const lastType = parsed[parsed.length - 1].type;
const needsWrite = () => actions.length > 0;
const writable = idleMs > IDLE_MS && lastType === 'turn/end';

// 1. torn tail / bad frame
if (rest.length > 0 || badFrame >= 0) {
  if (!writable) { needHuman = 'torn-tail-while-active'; }
  else { actions.push('truncate-torn-tail(' + rest.length + 'B, badFrame=' + badFrame + ')'); }
}

// 2. header frame structure
if (frameLines[0] !== 1 || parsed[0].type !== 'session') {
  if (!writable) needHuman = needHuman || 'header-while-active';
  else actions.push('rebuild-header-frame');
}

// 3. seq contiguity
const seqRows = parsed.filter((r) => typeof r.seq === 'number');
const gapFixes = [];
for (let i = 1; i < seqRows.length; i++) {
  const want = seqRows[i - 1].seq + 1;
  if (seqRows[i].seq > want) for (let g = want; g < seqRows[i].seq; g++) gapFixes.push(g);
  else if (seqRows[i].seq < want) { needHuman = needHuman || 'seq-duplicate-or-backwards'; break; }
}
if (gapFixes.length) {
  if (!writable) needHuman = needHuman || 'seq-gap-while-active';
  else actions.push('insert-noop(' + gapFixes.join(',') + ')');
}

// 4. tool-call pairing
const advertised = new Map();
let mismatch = 0;
for (const r of parsed) {
  if (r.type === 'assistant/message') {
    const m = typeof r.data.message === 'string' ? JSON.parse(r.data.message) : r.data.message;
    for (const b of (m.content || [])) if (b.type === 'tool-call') advertised.set(b.id, { name: b.name, arguments: b.arguments });
  } else if (r.type === 'tool/call') {
    const a = advertised.get(r.data.callId);
    if (a && (a.name !== r.data.name || a.arguments !== r.data.arguments)) mismatch++;
  }
}
if (mismatch) needHuman = needHuman || 'tool-call-arguments-mismatch(' + mismatch + ')';

// 5. size
const vis = visibleChars(rows);
notes.push('visibleChars=' + vis + ' idleMs=' + idleMs + ' last=' + lastType);
if (AUTO_FOLD && vis > VISIBLE_LIMIT) {
  if (!writable) needHuman = needHuman || 'oversize-while-active';
  else actions.push('fold-older-turns(keep=' + KEEP_TURNS + ')');
}

console.log('NOTES ' + notes.join(' ; '));
console.log('ACTIONS ' + (actions.length ? actions.join(', ') : 'none'));

function foldRows(list) {
  const turns = [];
  for (const r of list) if (r.type === 'turn/start') turns.push({ turn: r.data.turn, seq: r.seq });
  const maxTurn = turns.length ? turns[turns.length - 1].turn : 0;
  const keepFrom = maxTurn - KEEP_TURNS + 1;
  const turnOf = (seq) => { let lo = 0, hi = turns.length - 1, ans = 0; while (lo <= hi) { const mid = (lo + hi) >> 1; if (turns[mid].seq <= seq) { ans = turns[mid].turn; lo = mid + 1; } else hi = mid - 1; } return ans; };
  const emptyArgs = (v) => (typeof v === 'string' ? '{}' : {});
  let changed = 0;
  const out = list.map((line) => {
    const r = JSON.parse(line);
    const t = r.seq === undefined ? 0 : turnOf(r.seq);
    if (t >= keepFrom) return line;
    let touched = false;
    if (r.type === 'assistant/message') {
      const m = typeof r.data.message === 'string' ? JSON.parse(r.data.message) : r.data.message;
      const content = (m.content || []).map((b) => {
        if (b.type === 'reasoning' && (b.text || '').length > 80) { touched = true; return { ...b, text: '[本轮推理已折叠：原 ' + b.text.length + ' 字符]' }; }
        if (b.type === 'text' && (b.text || '').length > 1200) { touched = true; return { ...b, text: b.text.slice(0, 1200) + '\n[已截断：原 ' + b.text.length + ' 字符]' }; }
        if (b.type === 'tool-call' && (typeof b.arguments === 'string' ? b.arguments.length > 2 : Object.keys(b.arguments || {}).length > 0)) { touched = true; return { ...b, arguments: emptyArgs(b.arguments) }; }
        return b;
      });
      if (!touched) return line;
      const nm = { ...m, content };
      r.data.message = JSON.stringify(nm);
      changed++;
      return JSON.stringify(r);
    }
    if (r.type === 'tool/call') {
      const had = typeof r.data.arguments === 'string' ? r.data.arguments.length > 2 : Object.keys(r.data.arguments || {}).length > 0;
      if (!had) return line;
      r.data.arguments = emptyArgs(r.data.arguments);
      changed++;
      return JSON.stringify(r);
    }
    if (r.type === 'tool/result') {
      const msg = r.data.message;
      const content = (msg.content || []).map((c) => { if (c.type === 'text' && (c.text || '').length > 200) { touched = true; return { ...c, text: '[旧轮次工具输出已折叠：原 ' + c.text.length + ' 字符]' }; } return c; });
      if (!touched) return line;
      r.data.message = { ...msg, content };
      changed++;
      return JSON.stringify(r);
    }
    if (r.type === 'user/message') {
      const content = (r.data.content || []).map((c) => {
        if (c.type !== 'text') return c;
        const limit = r.data.source && r.data.source.kind === 'user' ? 2000 : 300;
        if ((c.text || '').length > limit) { touched = true; return { ...c, text: c.text.slice(0, limit) + '\n[已截断：原 ' + c.text.length + ' 字符]' }; }
        return c;
      });
      if (!touched) return line;
      r.data.content = content;
      changed++;
      return JSON.stringify(r);
    }
    return line;
  });
  return { out, changed, keepFrom };
}

let outRows = rows.slice();
if (actions.includes('insert-noop(' + gapFixes.join(',') + ')')) {
  const fixSet = new Set(gapFixes);
  const rebuilt = [];
  for (const line of outRows) {
    const r = JSON.parse(line);
    if (typeof r.seq === 'number') for (let g = (rebuilt.length ? JSON.parse(rebuilt[rebuilt.length - 1]).seq + 1 : g) ; g < r.seq; g++) { if (!fixSet.has(g)) break; rebuilt.push(JSON.stringify({ type: 'model/selection', seq: g, time: r.time, data: { provider: 'd1api', model: 'deepseek-v4.1-flash' } })); }
    rebuilt.push(line);
  }
  outRows = rebuilt;
}
if (actions.some((a) => a.startsWith('fold-older-turns'))) {
  const { out, changed, keepFrom } = foldRows(outRows);
  outRows = out;
  notes.push('folded changed=' + changed + ' keepFromTurn=' + keepFrom);
}

// validate + encode
const reparsed = outRows.map((l) => JSON.parse(l));
let seqBad = 0;
for (let i = 1; i < reparsed.length; i++) if (reparsed[i].seq !== i - 1) seqBad++;
const [h, ...events] = reparsed;
const artifact = { header: { id: h.id, createdAt: h.createdAt, isSeeded: h.isSeeded === true, origin: h.origin, parentSession: h.parentSession }, events, inheritedEventCount: 0 };
let adm = 0;
for (const row of reparsed) { try { assertV4RowAdmission(row, KNOWN_SESSION_EVENT_TYPES); } catch (e) { adm++; if (adm < 3) notes.push('ADM ' + row.seq + ' ' + row.type + ': ' + e.message); } }
let rel = 'PASS';
try { assertReleasedV4Relationships(artifact, KNOWN_SESSION_EVENT_TYPES); } catch (e) { rel = 'FAIL ' + e.message; }
const outBuf = encodeRows(outRows, frameLines);
const check = decodeBuffer(outBuf);
notes.push('out bytes=' + outBuf.length + ' seqBad=' + seqBad + ' adm=' + adm + ' rel=' + rel + ' firstFrameLines=' + check.frameLines[0] + ' outRows=' + check.rows.length);

const ok = seqBad === 0 && adm === 0 && rel === 'PASS' && check.frameLines[0] === 1 && check.rows.length === outRows.length;
console.log('NOTES ' + notes.join(' ; '));

if (!AUTO) { console.log('DRY act=' + JSON.stringify(actions) + ' ok=' + ok); console.log('STATUS=dry'); process.exit(0); }
if (!actions.length) { log({ status: 'ok', notes }); console.log('STATUS=ok'); process.exit(0); }
if (!ok) { log({ status: 'needhuman:repair-failed-validation', notes, actions }); console.log('STATUS=needhuman:repair-failed-validation'); process.exit(4); }
try {
  const w = writeAtomic(SRC, outBuf, { backupDir: BACKUP_DIR, expectSize: st.size, expectMtimeMs: st.mtimeMs });
  log({ status: 'repaired', actions, notes, backup: w.backupPath, bytes: w.bytes });
  console.log('STATUS=repaired ' + actions.join(','));
} catch (e) {
  log({ status: 'needhuman:write-failed', error: e.message, actions, notes });
  console.log('STATUS=needhuman:write-failed ' + e.message);
  process.exit(5);
}
