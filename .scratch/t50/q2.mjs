import { createRequire } from 'node:module';
import { join } from 'node:path';
const requireApi = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
const { Client } = requireApi('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap', options: '-c search_path=app,public' });
await c.connect();
for (const pat of ['作用与地位', '第一节']) {
  const r = await c.query(`SELECT id, name, num, source_id, parent_id, is_leaf, printed_page, source_page FROM knowledge_points WHERE name = $1`, [pat]);
  console.log('=== ' + pat + ' ===');
  for (const x of r.rows) console.log(JSON.stringify(x));
  for (const x of r.rows) {
    const sib = await c.query(`SELECT id, name, num, printed_page, is_leaf FROM knowledge_points WHERE source_id=$1 AND parent_id IS NOT DISTINCT FROM $2 AND printed_page BETWEEN $3 AND $4 ORDER BY printed_page, id`, [x.source_id, x.parent_id, (x.printed_page??0)-1, (x.printed_page??0)+1]);
    console.log('  siblings around:', JSON.stringify(sib.rows, null, 0));
  }
}
await c.end();
