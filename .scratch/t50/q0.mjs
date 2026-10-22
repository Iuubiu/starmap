import { createRequire } from 'node:module';
import { join } from 'node:path';
const requireApi = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
const { Client } = requireApi('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap', options: '-c search_path=app,public' });
await c.connect();
const r = await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='app' AND table_name='knowledge_points' ORDER BY ordinal_position`);
console.log(r.rows.map(x => `${x.column_name}:${x.data_type}`).join('\n'));
await c.end();
