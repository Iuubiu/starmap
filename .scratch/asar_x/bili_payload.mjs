import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('C:/Users/Yhwhy/.local/share/billion-context/sessions/index.db', { readOnly: true });
const SID = 'session-55c776d2-6df9-450c-abcf-db3fe6001ef9';
const rows = db.prepare('select block_id, ord, tier, active, payload_json from blocks where session_id=? order by ord desc limit 2').all(SID);
for (const r of rows) {
  const p = JSON.parse(r.payload_json);
  console.log('block ' + r.block_id + ' ord=' + r.ord + ' tier=' + r.tier + ' active=' + r.active + ' keys=' + JSON.stringify(Object.keys(p)));
  const s = JSON.stringify(p);
  console.log('  payload head: ' + s.slice(0, 500));
}
