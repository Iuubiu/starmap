import { createRequire } from 'node:module';
const require = createRequire('D:/DeepSeek/starmap/apps/api/package.json');
const { Client } = require('pg');
const c = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
await c.connect();
for (const t of ['knowledge_points','chunks','levels','level_items']) {
  const r = await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='app' AND table_name=$1 ORDER BY ordinal_position`, [t]);
  console.log(t, '→', r.rows.map(x=>x.column_name).join(', '));
}
await c.end();
