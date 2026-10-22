const { Client } = require('D:/DeepSeek/starmap/apps/api/node_modules/pg');
(async () => {
  const c = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
  await c.connect(); await c.query('SET search_path TO app, public');
  const n = await c.query(`SELECT count(*)::int n FROM knowledge_points WHERE source_id IS NULL`);
  console.log('NULL source_id nodes:', n.rows[0].n);
  const s = await c.query(`SELECT id, depth, is_leaf FROM knowledge_points WHERE source_id IS NULL ORDER BY id LIMIT 10`);
  for (const r of s.rows) console.log('  ', r.id, 'depth', r.depth, 'leaf', r.is_leaf);
  const tot = await c.query(`SELECT count(*)::int n, count(DISTINCT id)::int u FROM knowledge_points`);
  console.log('total', tot.rows[0].n, 'unique', tot.rows[0].u);
  await c.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
