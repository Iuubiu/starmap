// 一次性：列结构 + 关键表内容。
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Client } = require('pg');
const c = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
await c.connect();
const q = async (label, sql) => {
  try {
    const r = await c.query(sql);
    console.log(`\n### ${label}\n${JSON.stringify(r.rows).slice(0, 2000)}`);
  } catch (e) { console.log(`\n### ${label} FAILED: ${e.message}`); }
};
const cols = async (t) => q(`${t} 列`, `SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name='${t}' ORDER BY ordinal_position`);
await cols('level_items');
await cols('mastery');
await cols('video_clips');
await cols('video_sources');
await cols('level_market');
await q('level_items 全', `SELECT id, level_id, micro_kp_id, ordinal, pool FROM app.level_items ORDER BY level_id, ordinal LIMIT 45`);
await q('mastery 全行', `SELECT * FROM app.mastery`);
await q('video_clips 全', `SELECT * FROM app.video_clips ORDER BY id LIMIT 15`);
await q('kp-bool 的 items', `SELECT id, stem FROM app.level_items WHERE level_id='lv-bool-laws' ORDER BY ordinal`);
await c.end();
