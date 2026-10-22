import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Client } = require('pg');

const c = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
await c.connect();

// 有切片、但没有关卡的叶节点 —— 这类点上模型说 level_card 也拿不到关卡，
// 服务端会退化成 probe_form（turn.service.ts:823 的注释写明了这条退路）。
const rows = await c.query(`
  select kp.id, kp.name, count(ch.id)::int as chunks
  from app.knowledge_points kp
  join app.chunks ch on ch.micro_kp_id = kp.id
  where kp.is_leaf = true
    and not exists (select 1 from app.levels l where l.micro_kp_id = kp.id)
  group by kp.id, kp.name
  order by chunks desc
  limit 5`);
console.log('=== 有切片无关卡的叶节点 ===');
for (const r of rows.rows) console.log(`${r.id}\t${r.name}\tchunks=${r.chunks}`);
await c.end();
