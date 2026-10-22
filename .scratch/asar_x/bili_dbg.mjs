import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('C:/Users/Yhwhy/.local/share/billion-context/sessions/index.db', { readOnly: true });
const q = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch (e) { return 'ERR ' + e.message; } };
const SID = 'session-55c776d2-6df9-450c-abcf-db3fe6001ef9';
for (const id of ['b258', 'b250', 'b1']) {
  const r = q('select block_id, ord, tier, active, length(payload_json) plen, summary_hash, one_hash, supersedes_block_id, created_at from blocks where block_id=?', id);
  console.log(id + ' -> ' + JSON.stringify(r).slice(0, 400));
}
const big = q('select block_id, ord, length(payload_json) plen from blocks where session_id=? and length(payload_json) > 1000 limit 5', SID);
console.log('blocks with >1000B payload: ' + JSON.stringify(big).slice(0, 400));
console.log('sum plen=' + JSON.stringify(q('select sum(length(payload_json)) s, count(*) c from blocks where session_id=?', SID)));
console.log('messages cols=' + JSON.stringify(q('pragma table_info(messages)').map((c) => c.name)));
console.log('content cols=' + JSON.stringify(q('pragma table_info(content)').map((c) => c.name)));
