const fs = require('fs');
const { Client } = require('D:/DeepSeek/starmap/apps/api/node_modules/pg');

(async () => {
  const c = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
  await c.connect();
  await c.query('SET search_path TO app, public');
  for (const sid of ['guojiang-2014', 'spieler-2005', 'ahmed-2e', 'leo-2e']) {
    const toc = JSON.parse(fs.readFileSync(`content/${sid}/toc.json`, 'utf8'));
    const byId = new Map(toc.nodes.map((n) => [n.microKpId, n]));
    const r = await c.query(
      `SELECT k.id FROM knowledge_points k WHERE k.is_leaf AND k.source_id=$1
         AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.micro_kp_id=k.id)`,
      [sid],
    );
    console.log('==', sid, 'zero-chunk leaves:', r.rows.length);
    for (const row of r.rows) {
      const n = byId.get(row.id);
      if (!n) {
        console.log('   (not in toc)', row.id);
        continue;
      }
      const sib = toc.nodes.filter((x) => x.printedPage === n.printedPage && x.isLeaf);
      console.log(
        `   p${String(n.printedPage).padStart(4)} ${String(n.microKpId).padEnd(34)} leavesSamePage=${sib.length} name=${n.name.slice(0, 30)}`,
      );
    }
  }
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
