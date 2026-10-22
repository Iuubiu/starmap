import fs from 'node:fs';
import { decodeBuffer, visibleChars } from './lib_log.mjs';
const T = 'D:/DeepSeek/starmap/.agent-teams/starmap-build/team.json';
const SRC = 'C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/session-55c776d2-6df9-450c-abcf-db3fe6001ef9/session.v4.jsonl.zstd';
const now = Date.now();
const t = JSON.parse(fs.readFileSync(T, 'utf8'));
const c = {}; for (const x of t.tasks) c[x.status] = (c[x.status] || 0) + 1;
console.log('TEAM mtime=' + new Date(fs.statSync(T).mtimeMs).toISOString() + ' total=' + t.tasks.length + ' ' + JSON.stringify(c));
for (const x of t.tasks.filter((x) => !['completed', 'cancelled'].includes(x.status))) {
  console.log('  OPEN ' + x.id + ' ' + x.status + ' ' + x.assignee + ' upd=' + new Date(x.updatedAt).toISOString().slice(11, 16) + ' age=' + ((now - x.updatedAt) / 60000).toFixed(0) + 'm');
}
const st = fs.statSync(SRC);
const { rows } = decodeBuffer(fs.readFileSync(SRC));
const p = rows.map((l) => JSON.parse(l));
const last = p[p.length - 1];
const turns = p.filter((r) => r.type === 'turn/start').length;
console.log('SESSION bytes=' + st.size + ' rows=' + rows.length + ' turns=' + turns + ' visible=' + visibleChars(rows) + ' last=' + last.type + ' seq=' + last.seq + ' idle=' + ((now - last.time) / 60000).toFixed(1) + 'm');
const ends = p.filter((r) => r.type === 'turn/end').slice(-3).map((r) => 'turn' + r.data.turn + ':' + (r.data.reason && r.data.reason.kind));
console.log('recent turn/end ' + JSON.stringify(ends));
const calls = p.filter((r) => r.type === 'tool/call' && r.time > now - 3600e3);
console.log('tool calls last hour=' + calls.length + ' last call=' + (calls.length ? calls[calls.length - 1].data.name : '-'));
