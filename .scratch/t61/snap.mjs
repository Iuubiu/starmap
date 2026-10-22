// t61 取证：DB 侧改前/改后数字（含 A 类 SQL 计数、B 类名、chunk 归属、孤儿数）
import { createRequire } from 'node:module';
import { join } from 'node:path';

const requireApi = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
const { Client } = requireApi('pg');

const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap';
const c = new Client({ connectionString: url });
await c.connect();

const q = async (sql, params) => (await c.query(sql, params)).rows;

const out = {};
out.aClass = await q(`SELECT count(*)::int AS n FROM app.knowledge_points WHERE name ~ '^[、，。；：）)]'`);
out.aClassRows = await q(
  `SELECT id, source_id, name FROM app.knowledge_points WHERE name ~ '^[、，。；：）)]' ORDER BY id`
);
out.bClass = await q(`SELECT id, name FROM app.knowledge_points WHERE name IN ('作用与地位')`);
out.mergedName = await q(
  `SELECT id, name FROM app.knowledge_points WHERE name LIKE '%核技术应用中的%作用与地位%'`
);
out.kpTotal = await q(`SELECT count(*)::int AS n, count(*) FILTER (WHERE is_leaf) ::int AS leaf FROM app.knowledge_points`);
out.chunkNull = await q(`SELECT count(*)::int AS n FROM app.chunks WHERE micro_kp_id IS NULL`);
out.chunkTotal = await q(`SELECT count(*)::int AS n FROM app.chunks`);
out.cClass = await q(
  `SELECT id, name FROM app.knowledge_points
   WHERE name LIKE '附录A%' OR name LIKE '附录B%'
      OR name LIKE '%同轴型HPGe%' OR name LIKE '%HPGe探测器的主要%'
      OR name LIKE '%探测器望远镜%' OR name LIKE '%超灵敏加速器质谱仪%'
   ORDER BY id`
);
// 半截标题（以连接词结尾）——票面 AC⑤ 看板首推无半截标题
out.halfTitles = await q(
  `SELECT id, name FROM app.knowledge_points
   WHERE is_leaf AND name ~ '[的与和及或在对把从向以之为于而并]$' ORDER BY id`
);
out.chunkOwnedByFragment = await q(
  `SELECT count(*)::int AS n FROM app.chunks WHERE micro_kp_id = 'kp-dinghonglin-2010-p1-作用与地位'`
);
console.log(JSON.stringify(out, null, 2));
await c.end();
