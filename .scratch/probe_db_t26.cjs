const path = require('path');
const { Client } = require(path.resolve('apps/api/node_modules/pg'));
(async () => {
  const c = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
  await c.connect();
  await c.query('SET search_path TO app, public');
  const q = async (sql, p) => (await c.query(sql, p)).rows;
  console.log('== sources ==');
  for (const r of await q(`SELECT id, title, (SELECT count(*) FROM knowledge_points k WHERE k.source_id=s.id) AS kps, (SELECT count(*) FROM chunks ch WHERE ch.source_id=s.id) AS chunks FROM sources s ORDER BY id`))
    console.log(`${r.id}\t${r.title}\tkp=${r.kps}\tchunk=${r.chunks}`);
  console.log('== totals ==');
  console.log(await q(`SELECT count(*)::int AS kps, count(*) FILTER (WHERE is_leaf)::int AS leaves FROM knowledge_points`));
  console.log(await q(`SELECT count(*)::int AS chunks FROM chunks`));
  console.log(await q(`SELECT count(*)::int AS edges FROM kp_edges`));
  console.log(await q(`SELECT count(*)::int AS levels FROM levels`));
  console.log(await q(`SELECT count(*)::int AS attempts FROM attempts`));
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
