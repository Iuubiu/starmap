// AC7：content/<sid>/toc.json 的节点与 DB 逐本比对（id + name），mismatch 必须 0。
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const pg = require('D:/DeepSeek/starmap/apps/api/node_modules/pg');
const c = new pg.Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
await c.connect();

const BOOKS = [
  'analog-electronics-tongshibai-5e',
  'nuclear-physics-experiment-methods-1997',
  'nuclear-radiation-physics-chenboxian-2011',
  'radiation-detector-handbook-jichangsong-1990',
  'radiation-detectors-dinghonglin-2010',
];

let totalMismatch = 0;
for (const sid of BOOKS) {
  const p = join('content', sid, 'toc.json');
  if (!existsSync(p)) { console.log(`${sid}: 无 toc.json`); continue; }
  const nodes = JSON.parse(readFileSync(p, 'utf8')).nodes;
  const db = (await c.query('SELECT id, name FROM app.knowledge_points WHERE source_id = $1', [sid])).rows;
  const dbMap = new Map(db.map((r) => [r.id, r.name]));
  const fileIds = new Set(nodes.map((n) => n.microKpId));
  const mismatch = [];
  for (const n of nodes) {
    const d = dbMap.get(n.microKpId);
    if (d === undefined) mismatch.push(`DB 缺 ${n.microKpId}`);
    else if (d !== n.name) mismatch.push(`名字不同 ${n.microKpId}: file=${n.name} db=${d}`);
  }
  for (const id of dbMap.keys()) if (!fileIds.has(id)) mismatch.push(`DB 多 ${id}`);
  totalMismatch += mismatch.length;
  console.log(`${sid}: file ${nodes.length} / db ${db.length} / mismatch ${mismatch.length}`);
  for (const m of mismatch.slice(0, 5)) console.log('   ', m);
}
console.log(`总 mismatch = ${totalMismatch}`);
await c.end();
