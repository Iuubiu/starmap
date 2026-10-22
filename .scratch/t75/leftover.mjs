import { createRequire } from 'node:module';
import { join } from 'node:path';
const requireApi = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
const { Client } = requireApi('pg');
const c = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
await c.connect();
const r = await c.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'app_t75%' OR schema_name LIKE 'app_test%' OR schema_name LIKE 'mig_check%'");
console.log('leftover schemas:', r.rowCount, r.rows.map(x=>x.schema_name).join(', ') || '无');
await c.end();
