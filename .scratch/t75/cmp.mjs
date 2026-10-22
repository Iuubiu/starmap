import { createRequire } from 'node:module';
import { join } from 'node:path';
const requireApi = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
const { Client } = requireApi('pg');

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap';
const c = new Client({ connectionString: URL });
await c.connect();

// 1) 版本表里记了哪些
const applied = await c.query("SELECT version FROM app.schema_migrations ORDER BY version");
console.log('applied count =', applied.rowCount);

// 2) 库里真实存在哪些表
const tables = await c.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema='app' ORDER BY table_name",
);
console.log('app tables (' + tables.rowCount + '):', tables.rows.map(r => r.table_name).join(', '));
await c.end();
