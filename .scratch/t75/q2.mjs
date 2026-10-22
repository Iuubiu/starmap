import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const requireApi = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
const { Client } = requireApi('pg');
const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap';
const c = new Client({ connectionString: url });
await c.connect();
const v = await c.query('SELECT version, checksum FROM app.schema_migrations ORDER BY version');
const migDir = join(process.cwd(), 'apps', 'api', 'migrations');
let drift = 0;
for (const r of v.rows) {
  const sql = readFileSync(join(migDir, r.version), 'utf8');
  const sum = createHash('sha256').update(sql).digest('hex').slice(0, 16);
  if (sum !== r.checksum) { drift++; console.log('DRIFT', r.version, 'db=', r.checksum, 'file=', sum); }
}
console.log('checksum drift:', drift, '/', v.rows.length);
await c.end();
