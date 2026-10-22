// 一次性：写场景 05-20 需要的事实（关卡/节点/复验/市场/视频/缺口）。
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Client } = require('pg');
const c = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
await c.connect();
const q = async (label, sql) => {
  try {
    const r = await c.query(sql);
    console.log(`\n### ${label}\n${JSON.stringify(r.rows).slice(0, 2200)}`);
  } catch (e) { console.log(`\n### ${label} FAILED: ${e.message}`); }
};

await q('levels 全部', `SELECT id, micro_kp_id, title, kind, ordinal, jsonb_array_length(spec->'items') AS n, spec->'meta'->>'author' AS author, spec->'gating'->>'mode' AS gate FROM app.levels ORDER BY id`);
await q('leaf 且有题的节点', `SELECT k.id, k.name, count(i.id) AS items FROM app.knowledge_points k JOIN app.level_items i ON i.micro_kp_id = k.id WHERE k.is_leaf = true GROUP BY k.id, k.name ORDER BY items DESC LIMIT 12`);
await q('market 保存的', `SELECT level_id, saved_at FROM app.level_market ORDER BY saved_at DESC LIMIT 10`);
await q('review 排期', `SELECT micro_kp_id, state, current, achieved, next_review_at, review_interval_index FROM app.mastery ORDER BY next_review_at NULLS LAST LIMIT 20`);
await q('attempts 计数', `SELECT count(*) FROM app.attempts`);
await q('mastery 计数', `SELECT count(*) FROM app.mastery`);
await q('video_clips', `SELECT id, micro_kp_id, start_sec, end_sec, status FROM app.video_clips ORDER BY id LIMIT 15`);
await q('video 对齐的 kp', `SELECT DISTINCT micro_kp_id FROM app.video_clips WHERE micro_kp_id IS NOT NULL LIMIT 12`);
await q('content_gaps', `SELECT id, topic, reason, expected_role FROM app.content_gaps LIMIT 6`);
await q('kp-bool 树', `WITH RECURSIVE up AS (SELECT id, parent_id, name, is_leaf, 1 AS d FROM app.knowledge_points WHERE id='kp-bool' UNION ALL SELECT k.id, k.parent_id, k.name, k.is_leaf, up.d+1 FROM app.knowledge_points k JOIN up ON k.id=up.parent_id) SELECT * FROM up`);
await q('placement_profile', `SELECT * FROM app.placement_profile`);
await q('sessions', `SELECT count(*) FROM app.sessions`);
await c.end();
