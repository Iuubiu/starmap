const { Client } = require('D:/DeepSeek/starmap/apps/api/node_modules/pg');

const SIDS = [
  'knoll-3e-2000', 'knoll-4e-2010', 'tsoulfanidis-4e', 'grupen-2e-2008', 'ahmed-2e',
  'spieler-2005', 'leo-2e', 'nakhostin-2018', 'rivetti-2015', 'lutz-2007',
  'nicholson-1974', 'gilmore-2e-2008', 'debertin-1988', 'guojiang-2023', 'guojiang-2014',
];
const ZH = [
  'digital-kanghua-5e', 'nuclear-electronics-wangzhiying-1989', 'nuclear-electronics-wangjingjin-1983',
  'nuclear-radiation-measurement-tangbin', 'nuclear-radiation-physics-chenboxian-2011',
  'radiation-detectors-dinghonglin-2010', 'nuclear-physics-experiment-methods-1997',
  'radiation-detector-handbook-jichangsong-1990', 'analog-electronics-kanghuaguang-5e',
  'digital-electronics-yanshi-6e', 'analog-electronics-tongshibai-5e', 'circuit-analysis-lihansun-5e-vol1',
];

(async () => {
  const c = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
  await c.connect();
  await c.query('SET search_path TO app, public');

  const q = async (sql, params) => (await c.query(sql, params)).rows;

  const total = await q('SELECT count(*)::int n FROM chunks');
  const over = await q('SELECT count(*)::int n FROM chunks WHERE length(text) > 1200');
  console.log(`[1] app.chunks 总数 = ${total[0].n}`);
  console.log(`[2] length(text)>1200 = ${over[0].n}`);

  const mine = await q('SELECT count(*)::int n FROM chunks WHERE source_id = ANY($1::text[])', [SIDS]);
  const mineOver = await q(
    'SELECT count(*)::int n FROM chunks WHERE source_id = ANY($1::text[]) AND length(text) > 1200',
    [SIDS],
  );
  const zh = await q('SELECT count(*)::int n FROM chunks WHERE source_id = ANY($1::text[])', [ZH]);
  const zhOver = await q(
    'SELECT count(*)::int n FROM chunks WHERE source_id = ANY($1::text[]) AND length(text) > 1200',
    [ZH],
  );
  const paper = await q("SELECT count(*)::int n FROM chunks WHERE source_id LIKE 'paper-%'");
  const paperOver = await q(
    "SELECT count(*)::int n FROM chunks WHERE source_id LIKE 'paper-%' AND length(text) > 1200",
  );
  console.log(
    `    拆解：15 本新书 ${mine[0].n}（超长 ${mineOver[0].n}） / 12 本中文 ${zh[0].n}（超长 ${zhOver[0].n}） / paper-* ${paper[0].n}（超长 ${paperOver[0].n}）`,
  );

  const zero = await q(
    `SELECT count(*)::int n FROM knowledge_points k
      WHERE k.is_leaf AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.micro_kp_id = k.id)`,
  );
  const zeroMine = await q(
    `SELECT count(*)::int n FROM knowledge_points k
      WHERE k.is_leaf AND k.source_id = ANY($1::text[])
        AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.micro_kp_id = k.id)`,
    [SIDS],
  );
  console.log(`[3] 零 chunk 叶节点：全库 ${zero[0].n}，其中 15 本新书 ${zeroMine[0].n}`);

  const zeroBy = await q(
    `SELECT k.source_id, count(*)::int n FROM knowledge_points k
      WHERE k.is_leaf AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.micro_kp_id = k.id)
      GROUP BY k.source_id ORDER BY n DESC`,
  );
  console.log('    按来源：' + zeroBy.map((r) => `${r.source_id}=${r.n}`).join(' '));

  const cka = await q('SELECT count(*)::int n FROM chunk_kp_answer');
  console.log(`[5] chunk_kp_answer 总数 = ${cka[0].n}`);

  const leaves = await q(
    `SELECT count(*)::int n FROM knowledge_points WHERE is_leaf AND source_id = ANY($1::text[])`,
    [SIDS],
  );
  console.log(
    `    15 本新书叶节点 ${leaves[0].n}，零 chunk 占比 ${((zeroMine[0].n / leaves[0].n) * 100).toFixed(1)}%`,
  );

  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
