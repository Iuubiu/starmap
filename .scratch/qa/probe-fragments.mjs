import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Client } = require('pg');

const c = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
await c.connect();
const frag = await c.query(`
  select kp.id, kp.name, kp.depth, kp.is_leaf, src.title
  from app.knowledge_points kp
  left join app.sources src on src.id = kp.source_id
  where kp.is_leaf = true
    and (kp.name like '%作用与地位%' or kp.name like '%两类约束%' or kp.name like '%电流、电压及功率%')
  order by kp.id`);
console.log('=== 疑似碎片叶节点 ===');
for (const r of frag.rows) console.log(`${r.id}\t${r.name}\t${r.title}`);

const short = await c.query(`
  select count(*)::int as n from app.knowledge_points
  where is_leaf = true and length(name) <= 4`);
console.log('=== 全库 ≤4 字叶节点数 ===', short.rows[0].n);

const board = await c.query(`
  select kp.id, kp.name, kp.depth, kp.is_leaf
  from app.knowledge_points kp
  where kp.name like '%作用与地位%'
  order by kp.depth`);
console.log('=== 「作用与地位」全部节点 ===');
for (const r of board.rows) console.log(`${r.id}\t${r.name}\tdepth=${r.depth}\tleaf=${r.is_leaf}`);
await c.end();
