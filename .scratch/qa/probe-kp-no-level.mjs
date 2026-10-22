import { createRequire } from 'node:module';
const require = createRequire('D:/DeepSeek/starmap/apps/api/package.json');
const { Client } = require('pg');
const c = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
await c.connect();
const r = await c.query(`
  SELECT k.micro_kp_id, k.name,
         (SELECT count(*) FROM app.levels l WHERE l.micro_kp_id = k.micro_kp_id) AS levels,
         (SELECT count(*) FROM app.chunks ch WHERE ch.micro_kp_id = k.micro_kp_id) AS chunks
  FROM app.knowledge_points k
  WHERE k.is_leaf = true AND k.micro_kp_id LIKE 'kp-bool%'
  ORDER BY k.micro_kp_id LIMIT 10`);
console.log(r.rows);
const r2 = await c.query(`
  SELECT k.micro_kp_id, k.name,
         (SELECT count(*) FROM app.levels l WHERE l.micro_kp_id = k.micro_kp_id) AS levels
  FROM app.knowledge_points k
  WHERE k.is_leaf = true AND k.micro_kp_id NOT LIKE 'kp-paper-%'
    AND NOT EXISTS (SELECT 1 FROM app.levels l WHERE l.micro_kp_id = k.micro_kp_id)
  ORDER BY k.micro_kp_id LIMIT 8`);
console.log('--- 无关卡叶节点 ---');
console.log(r2.rows);
await c.end();
