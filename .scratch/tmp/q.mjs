import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const pg = require('pg');
const c = new pg.Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
await c.connect();
const q = async (label, sql, params = []) => {
  try {
    const r = await c.query(sql, params);
    console.log('###', label, JSON.stringify(r.rows).slice(0, 700));
  } catch (e) { console.log('###', label, 'ERR', e.message); }
};
await q('mastery cols', `SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name='mastery' ORDER BY ordinal_position`);
await q('mastery kp-bool', `SELECT * FROM app.mastery WHERE micro_kp_id='kp-bool'`);
await q('mastery count', `SELECT count(*) FROM app.mastery`);
await q('attempts kp-bool', `SELECT count(*) FROM app.attempts WHERE micro_kp_id='kp-bool'`);
await q('attempts total', `SELECT count(*) FROM app.attempts`);
await q('attempts recent', `SELECT id, micro_kp_id, level_id, first_try_correct, created_at FROM app.attempts ORDER BY created_at DESC LIMIT 4`);
await q('placement', `SELECT * FROM app.placement_profile`);
await q('levels kp-bool', `SELECT id, micro_kp_id, title FROM app.levels WHERE micro_kp_id='kp-bool'`);
await c.end();
