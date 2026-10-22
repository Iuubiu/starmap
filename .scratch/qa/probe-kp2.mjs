import { createRequire } from 'node:module';
const require = createRequire('D:/DeepSeek/starmap/apps/api/package.json');
const { Client } = require('pg');
const c = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
await c.connect();
const r = await c.query(`
  SELECT k.id, k.name,
         (SELECT count(*) FROM app.levels l WHERE l.micro_kp_id = k.id) AS levels,
         (SELECT count(*) FROM app.chunks ch WHERE ch.micro_kp_id = k.id) AS chunks
  FROM app.knowledge_points k WHERE k.is_leaf = true AND k.id LIKE 'kp-bool%' ORDER BY k.id`);
console.log('bool 叶:', r.rows);
const r2 = await c.query(`
  SELECT k.id, k.name,
         (SELECT count(*) FROM app.chunks ch WHERE ch.micro_kp_id = k.id) AS chunks
  FROM app.knowledge_points k
  WHERE k.is_leaf = true AND k.id NOT LIKE 'kp-paper-%'
    AND NOT EXISTS (SELECT 1 FROM app.levels l WHERE l.micro_kp_id = k.id)
    AND EXISTS (SELECT 1 FROM app.chunks ch WHERE ch.micro_kp_id = k.id)
  ORDER BY k.id LIMIT 6`);
console.log('--- 有 chunk 无 level 的叶 ---', r2.rows);
await c.end();
