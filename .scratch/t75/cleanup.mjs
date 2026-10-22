import { createRequire } from 'node:module';
import { join } from 'node:path';
const requireApi = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
const { Client } = requireApi('pg');
const admin = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/postgres' });
await admin.connect();
for (const name of ['starmap_t75', 'starmap_t75_entry']) {
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  console.log('dropped', name);
}
await admin.end();
