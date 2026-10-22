import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Client } = require('pg');

const c = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
await c.connect();

const q = async (label, sql) => {
  const r = await c.query(sql);
  console.log(label, JSON.stringify(r.rows[0]));
};

await q('kp_total / leaf  ', `select count(*)::int as total, count(*) filter (where is_leaf)::int as leaf from app.knowledge_points`);
await q('chunks total     ', `select count(*)::int as n from app.chunks`);
await q('levels           ', `select count(*)::int as n from app.levels`);
await q('attempts         ', `select count(*)::int as n from app.attempts`);
await q('graph edges      ', `select count(*)::int as n from app.kp_edges`);
await c.end();
