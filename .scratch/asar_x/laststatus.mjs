import fs from 'node:fs';
import { decodeBuffer } from './lib_log.mjs';
const SRC = 'C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/session-55c776d2-6df9-450c-abcf-db3fe6001ef9/session.v4.jsonl.zstd';
const { rows } = decodeBuffer(fs.readFileSync(SRC));
const parsed = rows.map((l) => JSON.parse(l));
let call = null;
for (let i = parsed.length - 1; i >= 0; i--) { const r = parsed[i]; if (r.type === 'tool/call' && r.data.name === 'agent_teams_status') { call = r; break; } }
if (!call) { console.log('no agent_teams_status call'); process.exit(0); }
console.log('call seq=' + call.seq + ' at ' + new Date(call.time).toISOString());
const res = parsed.find((r) => r.type === 'tool/result' && r.data.toolCallId === call.data.callId);
if (!res) { console.log('no result yet'); process.exit(0); }
const txt = (res.data.message.content || []).map((c) => c.text || '').join('');
console.log('result chars=' + txt.length + ' at ' + new Date(res.time).toISOString());
console.log(txt.slice(0, 3000));
