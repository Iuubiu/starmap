const { Client } = require('D:/DeepSeek/starmap/apps/api/node_modules/pg');
(async () => {
  const c = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
  await c.connect(); await c.query('SET search_path TO app, public');
  const r = await c.query(`
    SELECT k.source_id, count(*)::int n FROM knowledge_points k
    WHERE k.is_leaf = true AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.micro_kp_id = k.id)
    GROUP BY k.source_id ORDER BY n DESC`);
  for (const row of r.rows) console.log(String(row.source_id).padEnd(46), row.n);
  const s = await c.query(`
    SELECT k.id, k.source_id, k.name, k.depth, k.ordinal FROM knowledge_points k
    WHERE k.is_leaf = true AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.micro_kp_id = k.id)
    ORDER BY k.source_id, k.depth, k.ordinal LIMIT 60`);
  console.log('--- samples ---');
  for (const row of s.rows) console.log(' ', row.source_id, '|', row.name, '| depth', row.depth, 'ord', row.ordinal);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
