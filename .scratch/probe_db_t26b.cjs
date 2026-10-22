const { Client } = require('D:/DeepSeek/starmap/apps/api/node_modules/pg');
(async () => {
  const c = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
  await c.connect();
  await c.query('SET search_path TO app, public');
  const q = async (sql, p) => (await c.query(sql, p)).rows;
  console.log('== 全库 ==');
  console.log(await q(`SELECT count(*)::int AS kp, count(*) FILTER (WHERE is_leaf)::int AS leaves FROM knowledge_points`));
  console.log(await q(`SELECT count(*)::int AS chunks, count(*) FILTER (WHERE length(text) > 1200)::int AS over1200 FROM chunks`));
  console.log(await q(`SELECT count(*)::int AS edges FROM kp_edges`));
  console.log('== 15 本新书 ==');
  const rows = await q(`
    SELECT s.id,
           (SELECT count(*)::int FROM knowledge_points k WHERE k.id LIKE 'kp-%' AND k.id IN (
              SELECT k2.id FROM knowledge_points k2 WHERE k2.module_id LIKE 'mod-' || s.id || '-%')) AS kp,
           (SELECT count(*)::int FROM chunks c WHERE c.source_id = s.id) AS chunks,
           (SELECT count(*)::int FROM chunks c WHERE c.source_id = s.id AND length(c.text) > 1200) AS over1200
    FROM sources s ORDER BY s.id`);
  for (const r of rows) console.log(r.id.padEnd(42), 'kp=' + String(r.kp).padStart(5), 'chunks=' + String(r.chunks).padStart(6), 'over1200=' + r.over1200);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
