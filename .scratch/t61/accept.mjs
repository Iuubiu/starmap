// t61 验收 SQL 一次性跑完（AC1/AC2/AC4/AC5/AC7 的 DB 侧证据）。
// 列名注意：app.knowledge_points 的主键列叫 id（不是 micro_kp_id），app.chunks 才有 micro_kp_id。
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pg = require('D:/DeepSeek/starmap/apps/api/node_modules/pg');

const URL = 'postgres://postgres:postgres@127.0.0.1:5432/starmap';
const c = new pg.Client({ connectionString: URL });
await c.connect();

const one = async (label, sql, params = []) => {
  const r = await c.query(sql, params);
  console.log(`${label}: ${JSON.stringify(r.rows)}`);
};

await one('AC1 以标点开头的 name', "SELECT count(*)::int AS n FROM app.knowledge_points WHERE name ~ '^[、，。；：）)]'");
await one('AC2 「作用与地位」独立条目', "SELECT count(*)::int AS n FROM app.knowledge_points WHERE name IN ('作用与地位')");
await one('AC2 合并后含「作用与地位」', "SELECT id, name FROM app.knowledge_points WHERE name LIKE '%作用与地位%'");
await one('AC4 chunk 无归属', 'SELECT count(*)::int AS n FROM app.chunks WHERE micro_kp_id IS NULL');
await one(
  'AC5 叶节点里标点名/短名',
  "SELECT count(*)::int AS n FROM app.knowledge_points WHERE is_leaf AND (name ~ '^[、，。；：）)]' OR char_length(name) < 4)",
);

console.log('--- C 类三对必须仍各自独立 ---');
for (const pat of ['附录A%', '附录B%', '%同轴型HPGe%', '%HPGe探测器%', '%探测器望远镜%', '%超灵敏加速器质谱仪%']) {
  const r = await c.query('SELECT id, name FROM app.knowledge_points WHERE name LIKE $1 ORDER BY id', [pat]);
  for (const row of r.rows) console.log(`   ${row.id}: ${row.name}`);
}

console.log('--- A 类 10 个 id 现状（改后应为去标点的名字）---');
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
];
for (const id of ids) {
  const r = await c.query('SELECT id, name FROM app.knowledge_points WHERE id = $1', [id]);
  console.log(`   ${id} -> ${r.rows[0] ? r.rows[0].name : 'MISSING'}`);
}

await c.end();
