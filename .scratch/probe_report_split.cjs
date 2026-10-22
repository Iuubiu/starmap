const { Client } = require('D:/DeepSeek/starmap/apps/api/node_modules/pg');
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
  const q = async (sql) => (await c.query(sql)).rows;

  const rows = await q("SELECT COALESCE(source_id, '(null)') AS sid, count(*)::int AS n FROM knowledge_points GROUP BY 1 ORDER BY 2 DESC");
  let newSum = 0, zhSum = 0, other = [];
  for (const r of rows) {
    if (NEW.includes(r.sid)) newSum += r.n;
    else if (ZH.includes(r.sid)) zhSum += r.n;
    else other.push(r.sid + '=' + r.n);
  }
  console.log('15 本新书节点合计=' + newSum);
  console.log('12 本中文书节点合计=' + zhSum);
  console.log('其他来源：' + (other.join(', ') || '无'));

  const longBy = await q("SELECT COALESCE(source_id,'(null)') AS sid, count(*)::int AS n FROM chunks WHERE length(text) > 1200 GROUP BY 1 ORDER BY 2 DESC");
  console.log('超长 chunk 分布：');
  for (const r of longBy) console.log('   ' + r.sid + ': ' + r.n);

  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
