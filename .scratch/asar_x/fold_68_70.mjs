import fs from 'node:fs';
import { decodeBuffer, encodeRows, msgOf, visibleChars, writeAtomic } from './lib_log.mjs';
const SRC = 'C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/session-55c776d2-6df9-450c-abcf-db3fe6001ef9/session.v4.jsonl.zstd';
const BACKUP_DIR = 'D:/DeepSeek/starmap/.scratch/session-backup';
const APPLY = process.argv.includes('--apply');
const TURNS = new Set([68, 69, 70]);
const MIN_RESULT = 600, MIN_ARGS = 1500;

const st0 = fs.statSync(SRC);
const { rows, frameLines } = decodeBuffer(fs.readFileSync(SRC));
const parsed = rows.map((l) => JSON.parse(l));
const starts = parsed.filter((r) => r.type === 'turn/start');
const turnOf = (seq) => { let t = 0; for (const s of starts) { if (s.seq <= seq) t = s.data.turn; else break; } return t; };
const foldArgs = (v) => (typeof v === 'string' ? JSON.stringify({ _folded: '原 ' + v.length + ' 字符' }) : { _folded: '原 ' + JSON.stringify(v || {}).length + ' 字符' });

const out = [];
let changed = 0; let savedChars = 0;
for (const r of parsed) {
  const t = turnOf(r.seq);
  if (!TURNS.has(t)) { out.push(r); continue; }
  const orig = JSON.stringify(r);
  if (r.type === 'assistant/message') {
    const isStr = typeof r.data.message === 'string';
    const m = msgOf(r);
    const content = (m.content || []).map((b) => {
      if (b.type === 'reasoning' && (b.text || '').length > 0) { savedChars += b.text.length; return { ...b, text: '[本轮推理已折叠：原 ' + b.text.length + ' 字符]' }; }
      if (b.type === 'tool-call') {
        const len = typeof b.arguments === 'string' ? b.arguments.length : JSON.stringify(b.arguments || {}).length;
        if (len > MIN_ARGS) { savedChars += len; return { ...b, arguments: foldArgs(b.arguments) }; }
      }
      return b;
    });
    r.data = { ...r.data, message: isStr ? JSON.stringify({ ...m, content }) : { ...m, content } };
  } else if (r.type === 'tool/result') {
    const m = msgOf(r);
    const content = (m.content || []).map((b) => {
      const n = (b.text || '').length;
      if (n > MIN_RESULT) { savedChars += n; return { ...b, text: '[旧工具输出已折叠：原 ' + n + ' 字符]' }; }
      return b;
    });
    r.data = { ...r.data, message: { ...m, content } };
  } else if (r.type === 'tool/call') {
    const len = typeof r.data.arguments === 'string' ? r.data.arguments.length : JSON.stringify(r.data.arguments || {}).length;
    if (len > MIN_ARGS) { savedChars += len; r.data = { ...r.data, arguments: foldArgs(r.data.arguments) }; }
  }
  if (JSON.stringify(r) !== orig) changed++;
  out.push(r);
}
const lines = out.map((r) => JSON.stringify(r));
const buf = encodeRows(lines, frameLines);
const visBefore = visibleChars(rows), visAfter = visibleChars(lines);
console.log(JSON.stringify({ apply: APPLY, changed, savedKB: Math.round(savedChars / 1024), visBefore, visAfter, lines: lines.length, frames: frameLines.length, bytesBefore: st0.size, bytesAfter: buf.length }));
// integrity
const parsed2 = lines.map((l) => JSON.parse(l));
let seqBad = 0; for (let i = 1; i < parsed2.length; i++) if (parsed2[i].seq !== parsed2[i - 1].seq + 1) seqBad++;
const adv = new Map();
for (const r of parsed2) if (r.type === 'assistant/message') for (const b of (msgOf(r).content || [])) if (b.type === 'tool-call') adv.set(b.id, typeof b.arguments === 'string' ? b.arguments : JSON.stringify(b.arguments));
let badCalls = 0;
for (const r of parsed2) if (r.type === 'tool/call') { const a = typeof r.data.arguments === 'string' ? r.data.arguments : JSON.stringify(r.data.arguments); if (adv.get(r.data.toolCallId !== undefined ? r.data.toolCallId : r.data.callId) !== a) badCalls++; }
console.log('seqBad=' + seqBad + ' badCalls=' + badCalls);
if (APPLY) {
  if (seqBad || badCalls) throw new Error('integrity fail, not writing');
  const cur = fs.statSync(SRC);
  writeAtomic(SRC, buf, { backupDir: BACKUP_DIR, expectSize: cur.size, expectMtimeMs: cur.mtimeMs });
  console.log('WROTE ' + SRC);
}
