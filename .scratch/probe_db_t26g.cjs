const fs = require('fs');
const { Client } = require('D:/DeepSeek/starmap/apps/api/node_modules/pg');
(async () => {
  const c = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
  await c.connect(); await c.query('SET search_path TO app, public');
  const r = await c.query(`SELECT source_id, count(*)::int n, count(*) FILTER (WHERE length(text) > 1200)::int n_over FROM chunks GROUP BY source_id ORDER BY source_id`);
  let tn=0, to=0, mismatch=[];
  for (const row of r.rows) {
    const dir = `content/${row.source_id}/manifest.json`;
    let mc = null;
    try { mc = JSON.parse(fs.readFileSync(dir, 'utf8')).chunkCount; } catch {}
    const flag = mc === null ? '(no manifest)' : (mc === row.n ? 'ok' : `MISMATCH manifest=${mc}`);
    if (mc !== null && mc !== row.n) mismatch.push(row.source_id);
    console.log(`${String(row.source_id).padEnd(46)} db=${String(row.n).padStart(6)} over1200=${String(row.n_over).padStart(5)} ${flag}`);
    tn += row.n; to += row.n_over;
  }
  console.log('TOTAL db chunks =', tn, 'over1200 =', to, 'mismatches =', mismatch.length, mismatch.join(','));
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
