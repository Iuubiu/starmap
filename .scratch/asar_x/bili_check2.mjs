import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('C:/Users/Yhwhy/.local/share/billion-context/sessions/index.db', { readOnly: true });
const SID = 'session-55c776d2-6df9-450c-abcf-db3fe6001ef9';
const rows = db.prepare('select block_id, ord, start_seq, end_seq, tier, active, created_at, typeof(active) t, length(payload_json) plen from blocks where session_id=? order by created_at desc limit 6').all();
for (const b of rows) console.log(JSON.stringify({ id: b.block_id, ord: b.ord, s: b.start_seq, e: b.end_seq, tier: b.tier, active: b.active, t: b.t, at: new Date(b.created_at).toISOString().slice(11, 19), plen: b.plen }));
const cnt = db.prepare('select count(*) n, sum(case when active=1 then 1 else 0 end) act, max(end_seq) maxEnd, min(start_seq) minStart from blocks where session_id=?').get(SID);
console.log('total=' + cnt.n + ' active=' + cnt.act + ' span=' + cnt.minStart + '..' + cnt.maxEnd);
const recent = db.prepare('select count(*) n from blocks where session_id=? and created_at > ?').get(SID, Date.now() - 3600e3);
console.log('blocks created last hour=' + recent.n);
