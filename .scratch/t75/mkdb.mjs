import { createRequire } from 'node:module';
import { join } from 'node:path';
const requireApi = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
const { Client } = requireApi('pg');
const admin = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/postgres' });
await admin.connect();
const name = 'starmap_t75';
const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
if (exists.rowCount === 0) { await admin.query(`CREATE DATABASE ${name}`); console.log('created', name); }
else console.log('exists', name);
await admin.end();
