import { createRequire } from 'node:module';
import { join } from 'node:path';
const requireApi = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
const { Client } = requireApi('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap', options: '-c search_path=app,public' });
await c.connect();

async function show(label, sql, params) {
  const r = await c.query(sql, params);
  console.log('\n### ' + label + '  (' + r.rowCount + ')');
  for (const x of r.rows) console.log(JSON.stringify(x));
}

// 1. dinghonglin 的父节点与同级
await show('dinghonglin kp-1 子树', `
  SELECT id, parent_id, name, depth, is_leaf, ordinal, source_page
  FROM knowledge_points WHERE source_id='radiation-detectors-dinghonglin-2010' AND (id='kp-dinghonglin-2010-1' OR parent_id='kp-dinghonglin-2010-1')
  ORDER BY depth, ordinal`);

// 2. 以「第一节」开头的节点
await show('name LIKE 第一节%', `
  SELECT id, parent_id, name, depth, is_leaf, ordinal, source_page,
         (SELECT count(*) FROM chunks ch WHERE ch.micro_kp_id=k.id) nch
  FROM knowledge_points k WHERE name LIKE '第一节%' OR name LIKE '% 第一节%' ORDER BY source_id, source_page`);

// 3. 所有中文书的父节点，看父节点名字
await show('10 处碎片节点的父节点', `
  SELECT DISTINCT p.id, p.name, p.is_leaf, p.source_page, p.source_id, p.depth
  FROM knowledge_points k JOIN knowledge_points p ON p.id=k.parent_id
  WHERE k.name ~ '^[、，。；：）)]' ORDER BY p.id`);
await c.end();
