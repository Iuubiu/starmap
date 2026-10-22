
const { createRequire } = require('node:module');
const { join } = require('node:path');
const req = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
const { Client } = req('pg');
const queries = JSON.parse(process.argv[2]);
const frag = process.argv[3];
const keeper = process.argv[4];
(async () => {
  const c = new Client({ connectionString: 'postgres://postgres@127.0.0.1:5432/starmap' });
  await c.connect();
  const out = [];
  for (const q0 of queries) {
    const idx = [...q0.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    const maxIdx = idx.length ? Math.max(...idx) : 0;
    const params = [frag, keeper].slice(0, maxIdx);
    const q = q0.replace(/\$(\d+)/g, '$$$1::text');
    const r = await c.query(q, params);
    out.push(r.rows[0]);
  }
  await c.end();
  process.stdout.write(JSON.stringify(out));
})().catch((e) => { console.error(e); process.exit(1); });
