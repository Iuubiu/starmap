import fs from 'node:fs';
import { decodeBuffer, msgOf } from './lib_log.mjs';
const SRC = 'C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/session-55c776d2-6df9-450c-abcf-db3fe6001ef9/session.v4.jsonl.zstd';
const { rows } = decodeBuffer(fs.readFileSync(SRC));
const p = rows.map((l) => JSON.parse(l));
const starts = p.filter((r) => r.type === 'turn/start');
const turnOf = (seq) => { let t = 0; for (const s of starts) { if (s.seq <= seq) t = s.data.turn; else break; } return t; };
const big = [];
for (const r of p) {
  const t = turnOf(r.seq);
  if (t < 68) continue;
  let n = 0, detail = '';
  if (r.type === 'assistant/message') { const m = msgOf(r); for (const b of m.content || []) { const l = (b.text || '').length; n += l; if (l > 20000) detail += '[reasoning/text ' + (b.type) + ' ' + l + ']'; if (typeof b.arguments === 'string' && b.arguments.length > 20000) { n += b.arguments.length; detail += '[args ' + b.name + ' ' + b.arguments.length + ']'; } } }
  else if (r.type === 'tool/result') { const m = msgOf(r); for (const b of m.content || []) n += (b.text || '').length; detail = 'toolResult ' + (m.toolCallId || '').slice(0, 22) + ' ' + n; }
  else if (r.type === 'user/message') { for (const b of (r.data && r.data.content) || []) n += (b.text || '').length; detail = 'user ' + ((r.data && r.data.source && r.data.source.kind) || '?'); }
  if (n > 60000) big.push({ seq: r.seq, t, type: r.type, n, detail });
}
big.sort((a, b) => b.n - a.n);
for (const x of big.slice(0, 20)) console.log(JSON.stringify(x));
console.log('total big bytes=' + (big.reduce((s, x) => s + x.n, 0) / 1024).toFixed(0) + 'KB in ' + big.length + ' events');
