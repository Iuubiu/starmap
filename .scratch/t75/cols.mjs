import { createRequire } from 'node:module';
import { join } from 'node:path';
const requireApi = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
const { Client } = requireApi('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
await c.connect();
const r = await c.query(`SELECT table_name, column_name FROM information_schema.columns
  WHERE table_schema='app' AND table_name IN ('placement_profile','placement_rejudges') ORDER BY table_name, ordinal_position`);
for (const row of r.rows) console.log(row.table_name + '.' + row.column_name);
await c.end();
