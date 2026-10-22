// 一次性：写场景需要的事实（第二轮）。
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Client } = require('pg');

const c = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
await c.connect();
const q = async (label, sql) => {
  try {
    const r = await c.query(sql);
    console.log(`\n### ${label}\n${JSON.stringify(r.rows).slice(0, 2000)}`);
  } catch (e) {
    console.log(`\n### ${label} FAILED: ${e.message}`);
  }
};

await q('review_rounds', `SELECT * FROM app.review_rounds ORDER BY created_at DESC LIMIT 3`);
await q('review_round_items', `SELECT * FROM app.review_round_items LIMIT 3`);
await q('video_clips 列', `SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name='video_clips'`);
await q('video_clips', `SELECT id, micro_kp_id, start_sec, end_sec FROM app.video_clips LIMIT 5`);
await q('video_sources', `SELECT id, title, duration_sec FROM app.video_sources LIMIT 5`);
await q('content_gaps', `SELECT * FROM app.content_gaps LIMIT 5`);
await q('skill_switches', `SELECT * FROM app.skill_switches LIMIT 5`);
await q('level_market', `SELECT * FROM app.level_market LIMIT 5`);
await q('attempts 最近', `SELECT id, item_id, level_id, micro_kp_id, correct, counts_toward_mastery FROM app.attempts ORDER BY created_at DESC LIMIT 3`);
await q('level_items lv-bool-laws', `SELECT id, item_id, stem FROM app.level_items WHERE level_id='lv-bool-laws' LIMIT 5`);
await q('lv-bool-laws spec 的 steps', `SELECT jsonb_path_query(spec, '$.steps[*].kind') FROM app.levels WHERE id='lv-bool-laws'`);
await c.end();
