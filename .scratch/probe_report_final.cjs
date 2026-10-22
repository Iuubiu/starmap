const { Client } = require('D:/DeepSeek/starmap/apps/api/node_modules/pg');
const fs = require('fs');
const NEW = ['knoll-3e-2000', 'knoll-4e-2010', 'tsoulfanidis-4e', 'grupen-2e-2008', 'ahmed-2e',
  'spieler-2005', 'leo-2e', 'nakhostin-2018', 'rivetti-2015', 'lutz-2007',
  'nicholson-1974', 'gilmore-2e-2008', 'debertin-1988', 'guojiang-2023', 'guojiang-2014'];
const ZH = ['digital-kanghua-5e', 'nuclear-electronics-wangzhiying-1989', 'nuclear-electronics-wangjingjin-1983',
  'nuclear-radiation-measurement-tangbin', 'nuclear-radiation-physics-chenboxian-2011', 'radiation-detectors-dinghonglin-2010',
  'nuclear-physics-experiment-methods-1997', 'radiation-detector-handbook-jichangsong-1990', 'analog-electronics-kanghuaguang-5e',
  'digital-electronics-yanshi-6e', 'analog-electronics-tongshibai-5e', 'circuit-analysis-lihansun-5e-vol1'];

(async () => {
  const c = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
  await c.connect();
  await c.query('SET search_path TO app, public');
  const q = async (sql, p) => (await c.query(sql, p)).rows;

  const total = async (sql) => (await q(sql))[0].total;
  console.log('全库 knowledge_points=' + await total('SELECT count(*)::int AS total FROM knowledge_points')
    + ' 叶=' + await total('SELECT count(*)::int AS total FROM knowledge_points WHERE is_leaf')
    + ' chunks=' + await total('SELECT count(*)::int AS total FROM chunks')
    + ' chunk_kp_answer=' + await total('SELECT count(*)::int AS total FROM chunk_kp_answer')
    + ' length>1200=' + await total('SELECT count(*)::int AS total FROM chunks WHERE length(text) > 1200'));

  const per = await q('SELECT source_id, count(*)::int AS n FROM chunks GROUP BY source_id ORDER BY source_id');
  let bad = 0;
  for (const sid of NEW) {
    const row = per.find((r) => r.source_id === sid);
    const n = row ? row.n : 0;
    const mf = JSON.parse(fs.readFileSync('content/' + sid + '/manifest.json', 'utf8')).chunkCount;
    if (n !== mf) { bad++; console.log('  MISMATCH ' + sid + ': db=' + n + ' manifest=' + mf); }
  }
  console.log('15 本 manifest vs 库 chunk：' + (bad === 0 ? '15/15 全部相等' : bad + ' 本不等'));

  let zhTotal = 0;
  for (const sid of ZH) { const r = per.find((x) => x.source_id === sid); zhTotal += r ? r.n : 0; }
  console.log('12 本中文书 chunk 合计=' + zhTotal + '（基线 73248）');

  const zero = await q('SELECT n.source_id, count(*)::int AS n FROM knowledge_points n WHERE n.is_leaf AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.micro_kp_id = n.id) GROUP BY n.source_id ORDER BY n.source_id');
  const zeroNew = zero.filter((r) => NEW.includes(r.source_id));
  console.log('零 chunk 叶节点：全库=' + zero.reduce((a, r) => a + r.n, 0) + '，其中 15 本新书=' + zeroNew.reduce((a, r) => a + r.n, 0));
  for (const r of zeroNew) console.log('   ' + r.source_id + ': ' + r.n);

  const dup = await q('SELECT id, count(*)::int AS n FROM knowledge_points GROUP BY id HAVING count(*) > 1');
  console.log('跨书重复 id 数=' + dup.length);

  let tocNodes = 0;
  for (const sid of NEW) tocNodes += JSON.parse(fs.readFileSync('content/' + sid + '/toc.json', 'utf8')).nodeCount;
  console.log('15 本 toc.json nodeCount 合计=' + tocNodes);

  const perBook = await q('SELECT source_id, count(*)::int AS n FROM knowledge_points GROUP BY source_id');
  let nodeBad = 0;
  for (const sid of NEW) {
    const row = perBook.find((r) => r.source_id === sid);
    const n = row ? row.n : 0;
    const toc = JSON.parse(fs.readFileSync('content/' + sid + '/toc.json', 'utf8')).nodeCount;
    if (n !== toc) { nodeBad++; console.log('  NODE MISMATCH ' + sid + ': db=' + n + ' toc=' + toc); }
  }
  console.log('15 本 toc nodeCount vs 库节点数：' + (nodeBad === 0 ? '15/15 全部相等' : nodeBad + ' 本不等'));

  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
