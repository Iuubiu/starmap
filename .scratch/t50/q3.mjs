import { createRequire } from 'node:module';
import { join } from 'node:path';
const requireApi = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
const { Client } = requireApi('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap', options: '-c search_path=app,public' });
await c.connect();
const r = await c.query(`
  SELECT k.id, k.source_id, k.parent_id, k.name, k.depth, k.is_leaf, k.ordinal, k.source_page,
         (SELECT count(*) FROM chunks ch WHERE ch.micro_kp_id = k.id) AS nchunks,
         p.name AS parent_name
  FROM knowledge_points k LEFT JOIN knowledge_points p ON p.id = k.parent_id
  WHERE k.name ~ '^[、，。；：）)]'
  ORDER BY k.source_id, k.ordinal`);
console.log('count =', r.rowCount);
for (const x of r.rows) console.log(JSON.stringify(x, null, 0));
await c.end();
