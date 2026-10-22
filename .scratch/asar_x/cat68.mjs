import fs from 'node:fs';
import { decodeBuffer, msgOf } from './lib_log.mjs';
const SRC = 'C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/session-55c776d2-6df9-450c-abcf-db3fe6001ef9/session.v4.jsonl.zstd';
const { rows } = decodeBuffer(fs.readFileSync(SRC));
const p = rows.map((l) => JSON.parse(l));
const starts = p.filter((r) => r.type === 'turn/start');
const turnOf = (seq) => { let t = 0; for (const s of starts) { if (s.seq <= seq) t = s.data.turn; else break; } return t; };
const cat = {};
const add = (k, n) => { cat[k] = (cat[k] || 0) + n; };
for (const r of p) {
  const t = turnOf(r.seq);
  if (t < 68) continue;
  if (r.type === 'assistant/message') {
    const m = msgOf(r);
    for (const b of m.content || []) {
      if (b.type === 'reasoning') add('reasoning', (b.text || '').length);
      else if (b.type === 'text') add('assistantText', (b.text || '').length);
      else if (b.type === 'tool-call') add('callArgs', typeof b.arguments === 'string' ? b.arguments.length : JSON.stringify(b.arguments || {}).length);
    }
  } else if (r.type === 'tool/result') {
    const m = msgOf(r);
    let n = 0; for (const b of m.content || []) n += (b.text || '').length;
    add('toolResult', n); add('toolResultCount', 1);
  } else if (r.type === 'user/message') {
    for (const b of (r.data && r.data.content) || []) add('userText', (b.text || '').length);
  }
}
for (const [k, v] of Object.entries(cat)) console.log(k + ' = ' + (k.endsWith('Count') ? v : (v / 1024).toFixed(0) + 'KB'));
const total = Object.entries(cat).filter(([k]) => !k.endsWith('Count')).reduce((s, [, v]) => s + v, 0);
console.log('TOTAL turns>=68 = ' + (total / 1024).toFixed(0) + 'KB');
