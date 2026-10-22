import { createRequire } from 'node:module';
import { join } from 'node:path';
const requireApi = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
const { Client } = requireApi('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap', options: '-c search_path=app,public' });
await c.connect();

console.log('=== A 类：name 以标点开头 ===');
let r = await c.query(`SELECT k.id, k.source_id, k.parent_id, k.name, k.source_page, k.is_leaf, k.ordinal,
  (SELECT count(*) FROM chunks ch WHERE ch.micro_kp_id=k.id) nch,
  (SELECT count(*) FROM knowledge_points c2 WHERE c2.parent_id=k.id) nkid
  FROM knowledge_points k WHERE k.name ~ '^[、，。；：）)]' ORDER BY k.source_id, k.ordinal`);
console.log('count=', r.rowCount);
for (const x of r.rows) console.log(JSON.stringify(x));

console.log('\n=== B 类：作用与地位 ===');
r = await c.query(`SELECT id, source_id, parent_id, name, source_page, is_leaf, ordinal FROM knowledge_points WHERE name = '作用与地位' OR name LIKE '%作用与地位%'`);
for (const x of r.rows) console.log(JSON.stringify(x));

console.log('\n=== chunks micro_kp_id IS NULL ===');
r = await c.query(`SELECT count(*) FROM chunks WHERE micro_kp_id IS NULL`);
console.log(r.rows[0].count);

console.log('\n=== 总 kp ===');
r = await c.query(`SELECT count(*) kp, count(*) FILTER (WHERE is_leaf) leaf FROM knowledge_points`);
console.log(JSON.stringify(r.rows[0]));
await c.end();
