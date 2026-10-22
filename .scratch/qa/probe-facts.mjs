// 一次性：把写场景需要的真实事实倒出来。
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Client } = require('pg');

const c = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
await c.connect();

const q = async (label, sql) => {
  try {
    const r = await c.query(sql);
    console.log(`\n### ${label}`);
    console.log(JSON.stringify(r.rows, null, 1).slice(0, 2500));
  } catch (e) {
    console.log(`\n### ${label} FAILED: ${e.message}`);
  }
};

await q('关卡与知识点', `
  SELECT l.id, l.micro_kp_id, l.title, k.name AS kp_name, k.is_leaf,
         jsonb_array_length(COALESCE(l.spec->'items','[]'::jsonb)) AS n_items
  FROM app.levels l LEFT JOIN app.knowledge_points k ON k.id = l.micro_kp_id
  ORDER BY l.micro_kp_id LIMIT 20`);

await q('有 chunk 的知识点（视频/来源用）', `
  SELECT micro_kp_id, count(*) AS n FROM app.chunks GROUP BY 1 ORDER BY 2 DESC LIMIT 5`);

await q('来源', `SELECT id, kind, title FROM app.sources ORDER BY id LIMIT 12`);

await q('复验到期', `
  SELECT micro_kp_id, due_at, interval_days FROM app.review_schedule
  WHERE due_at <= now() ORDER BY due_at LIMIT 5`);

await q('掌握度', `SELECT micro_kp_id, state, current, achieved FROM app.mastery LIMIT 10`);

await q('定级档位', `SELECT * FROM app.placement_profile`);

await q('视频片段', `
  SELECT c.id, c.level_id, c.micro_kp_id, c.start_sec, c.end_sec
  FROM app.video_clips c LIMIT 5`);

await q('学习日志条数', `SELECT count(*) FROM app.learning_log`);

await c.end();
