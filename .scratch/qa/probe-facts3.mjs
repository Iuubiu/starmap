// 一次性：第三轮事实（关卡 spec 摘要、mastery 到期列、placement 状态机）。
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Client } = require('pg');
const c = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
await c.connect();
const q = async (label, sql) => {
  try {
    const r = await c.query(sql);
    console.log(`\n### ${label}\n${JSON.stringify(r.rows).slice(0, 1800)}`);
  } catch (e) { console.log(`\n### ${label} FAILED: ${e.message}`); }
};

await q('mastery 列', `SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='app' AND table_name='mastery'`);
await q('mastery 全行', `SELECT * FROM app.mastery`);
await q('lv-bool-laws meta+gating', `SELECT spec->'meta' AS meta, spec->'gating' AS gating, jsonb_array_length(spec->'items') AS n FROM app.levels WHERE id='lv-bool-laws'`);
await q('lv-ai-kp-tangbin-6-7 meta', `SELECT spec->'meta' AS meta, spec->'gating' AS gating FROM app.levels WHERE id='lv-ai-kp-tangbin-6-7'`);
await q('levels 总数', `SELECT count(*) FROM app.levels`);
await q('chunk 归属某 kp', `SELECT count(*) FROM app.chunks WHERE micro_kp_id='kp-bool'`);
await q('kp-bool 祖先链', `WITH RECURSIVE up AS (
  SELECT id, parent_id, name, 1 AS d FROM app.knowledge_points WHERE id='kp-bool'
  UNION ALL SELECT k.id, k.parent_id, k.name, up.d+1 FROM app.knowledge_points k JOIN up ON k.id=up.parent_id)
  SELECT * FROM up`);
await q('agent_turns 最近', `SELECT id, session_id, visible_response_kind, artifact_kind FROM app.agent_turns ORDER BY created_at DESC LIMIT 3`);
await q('sessions', `SELECT id, created_at FROM app.sessions ORDER BY created_at DESC LIMIT 3`);
await c.end();
