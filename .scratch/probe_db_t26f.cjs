const { Client } = require('D:/DeepSeek/starmap/apps/api/node_modules/pg');
(async () => {
  const c = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
  await c.connect(); await c.query('SET search_path TO app, public');
  const sids = ['knoll-3e-2000','knoll-4e-2010','tsoulfanidis-4e','grupen-2e-2008','ahmed-2e','spieler-2005','leo-2e','nakhostin-2018','rivetti-2015','lutz-2007','nicholson-1974','gilmore-2e-2008','debertin-1988','guojiang-2023','guojiang-2014'];
  const q = await c.query(`SELECT count(*)::int n, count(*) FILTER (WHERE length(text) > 1200)::int n_over FROM chunks WHERE source_id = ANY($1::text[])`, [sids]);
  console.log('15 books chunks =', q.rows[0].n, 'over1200 =', q.rows[0].n_over);
  const all = await c.query(`SELECT count(*)::int n, count(*) FILTER (WHERE length(text) > 1200)::int n_over FROM chunks`);
  console.log('ALL chunks =', all.rows[0].n, 'over1200 =', all.rows[0].n_over);
  const zero = await c.query(`SELECT count(*)::int n FROM knowledge_points k WHERE k.is_leaf = true AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.micro_kp_id = k.id)`);
  console.log('zero-chunk leaf nodes (all) =', zero.rows[0].n);
  const zero15 = await c.query(`SELECT count(*)::int n FROM knowledge_points k WHERE k.is_leaf = true AND k.source_id = ANY($1::text[]) AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.micro_kp_id = k.id)`, [sids]);
  console.log('zero-chunk leaf nodes (15 books) =', zero15.rows[0].n);
  const zc = await c.query(`SELECT source_id, count(*)::int n FROM chunks WHERE source_id = ANY($1::text[]) GROUP BY source_id ORDER BY source_id`, ['digital-kanghua-5e','nuclear-electronics-wangzhiying-1989','nuclear-electronics-wangjingjin-1983','nuclear-radiation-measurement-tangbin','nuclear-radiation-physics-chenboxian-2011','radiation-detectors-dinghonglin-2010','nuclear-physics-experiment-methods-1997','radiation-detector-handbook-jichangsong-1990','analog-electronics-kanghuaguang-5e','digital-electronics-yanshi-6e','analog-electronics-tongshibai-5e','circuit-analysis-lihansun-5e-vol1']);
  let t=0; for (const r of zc.rows) { console.log('  ZH', r.source_id.padEnd(45), r.n); t+=r.n; }
  console.log('12 Chinese books chunks =', t);
  const cka = await c.query(`SELECT count(*)::int n FROM chunk_kp_answer`);
  console.log('chunk_kp_answer total =', cka.rows[0].n);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
