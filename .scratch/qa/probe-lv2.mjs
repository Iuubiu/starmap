import { createRequire } from 'node:module';
const require = createRequire('D:/DeepSeek/starmap/apps/api/package.json');
const pg = require('pg');
const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
await c.connect();
const r = await c.query(`select l.id, l.micro_kp_id, l.title, k.name, k.is_leaf, count(li.id)::int as items
  from app.levels l join app.knowledge_points k on k.id=l.micro_kp_id
  left join app.level_items li on li.level_id=l.id
  group by 1,2,3,4,5 order by items desc limit 12`);
console.table(r.rows);
await c.end();
