import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pg = require('D:/DeepSeek/starmap/apps/api/node_modules/pg');
const c = new pg.Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
await c.connect();
const ids = [
  'kp-tongshibai-5e-p598-晶体三极管模型及其参数',
  'kp-methods-1997-p28-带电粒子在靶物质中的慢化',
  'kp-methods-1997-p30-重带电粒子在物质中的能量损失',
  'kp-methods-1997-p44-重离子的电子阻止本领',
  'kp-methods-1997-p20-倍增过程统计学',
  'kp-methods-1997-p375-中子全截面测量',
  'kp-methods-1997-p325-概述',
  'kp-chenboxian-2011-13-4',
  'kp-jichangsong-1990-p472-光导纤维光导',
  'kp-jichangsong-1990-4-2-1',
  'kp-dinghonglin-2010-1-1',
];
for (const id of ids) {
  const r = await c.query('SELECT id, name, source_id, source_page FROM app.knowledge_points WHERE id = $1', [id]);
  const row = r.rows[0];
  console.log(`${row.source_id}\t${row.id}\t${row.source_page}\t${row.name}`);
}
console.log('--- dinghonglin 旧 id 是否还在 ---');
const gone = await c.query("SELECT count(*)::int n FROM app.knowledge_points WHERE id = 'kp-dinghonglin-2010-p1-作用与地位'");
console.log(gone.rows[0]);
console.log('--- dinghonglin 该书节点数 ---');
const cnt = await c.query("SELECT count(*)::int n FROM app.knowledge_points WHERE source_id = 'radiation-detectors-dinghonglin-2010'");
console.log(cnt.rows[0]);
await c.end();
