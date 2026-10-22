const { Client } = require('D:/DeepSeek/starmap/apps/api/node_modules/pg');
(async () => {
  const c = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
  await c.connect(); await c.query('SET search_path TO app, public');
  const r = await c.query(`SELECT source_id, count(*)::int n FROM knowledge_points GROUP BY source_id ORDER BY source_id`);
  for (const row of r.rows) console.log(row.source_id.padEnd(40), row.n);
  console.log('sum', r.rows.reduce((a,b)=>a+b.n,0));
  await c.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
