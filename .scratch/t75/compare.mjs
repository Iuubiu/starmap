/**
 * 全量比对：真实库 app schema 的结构 vs 「按 migrations 从零建出来」的结构。
 * 目的：找出任何「代码要、库里没有」的残留项。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const requireApi = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
const { Client } = requireApi('pg');
const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap';
const migDir = join(process.cwd(), 'apps', 'api', 'migrations');

const c = new Client({ connectionString: url });
await c.connect();

const tmp = `mig_fresh_${randomBytes(4).toString('hex')}`;
await c.query(`CREATE SCHEMA ${tmp}`);
await c.query(`SET search_path TO ${tmp}, public`);

const files = readdirSync(migDir)
  .filter((f) => f.endsWith('.sql') && !f.includes('.down.') && !f.startsWith('seed'))
  .sort();

let applied = 0;
for (const f of files) {
  const raw = readFileSync(join(migDir, f), 'utf8');
  const sql = raw.replaceAll('app.', `${tmp}.`);
  const bare = sql.replace(/--[^\n]*/g, '');
  if (/(?<![\w.])app(?![\w.])/i.test(bare)) throw new Error(`${f} 含不带点的 app`);
  await c.query(sql);
  applied++;
}
console.log(`fresh schema ${tmp}: 应用了 ${applied} 个迁移`);

async function structure(schema) {
  const cols = await c.query(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema = $1
      ORDER BY table_name, column_name`,
    [schema],
  );
  const idx = await c.query(
    `SELECT tablename, indexname FROM pg_indexes WHERE schemaname = $1 ORDER BY tablename, indexname`,
    [schema],
  );
  const tbl = await c.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
    [schema],
  );
  const m = new Map();
  for (const r of cols.rows) m.set(`${r.table_name}.${r.column_name}`, r);
  return { cols: m, idx: new Set(idx.rows.map((r) => `${r.tablename}.${r.indexname}`)), tbl: new Set(tbl.rows.map((r) => r.table_name)) };
}

const real = await structure('app');
const fresh = await structure(tmp);

const missingTables = [...fresh.tbl].filter((t) => !real.tbl.has(t));
const extraTables = [...real.tbl].filter((t) => !fresh.tbl.has(t));
const missingCols = [...fresh.cols.keys()].filter((k) => !real.cols.has(k));
const extraCols = [...real.cols.keys()].filter((k) => !fresh.cols.has(k));
const missingIdx = [...fresh.idx].filter((i) => !real.idx.has(i));
const extraIdx = [...real.idx].filter((i) => !fresh.idx.has(i));

const typeDrift = [];
for (const [k, f] of fresh.cols) {
  const r = real.cols.get(k);
  if (!r) continue;
  if (r.data_type !== f.data_type) typeDrift.push(`${k}: real=${r.data_type} fresh=${f.data_type}`);
  if (r.is_nullable !== f.is_nullable) typeDrift.push(`${k}: nullable real=${r.is_nullable} fresh=${f.is_nullable}`);
}

console.log('\n=== 库缺（代码要、库里没有）===');
console.log('表:', missingTables.length ? missingTables : '0 处');
console.log('列:', missingCols.length ? missingCols : '0 处');
console.log('索引:', missingIdx.length ? missingIdx : '0 处');
console.log('\n=== 库多（库里残留、代码不再要）===');
console.log('表:', extraTables.length ? extraTables : '0 处');
console.log('列:', extraCols.length ? extraCols : '0 处');
console.log('索引:', extraIdx.length ? extraIdx : '0 处');
console.log('\n=== 类型/可空性漂移 ===');
console.log(typeDrift.length ? typeDrift : '0 处');

await c.query(`DROP SCHEMA ${tmp} CASCADE`);
await c.end();
