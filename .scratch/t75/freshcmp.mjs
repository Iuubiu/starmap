/**
 * 「代码要、库里没有」的全量比对。
 *
 * 不用正则解析迁移 SQL —— 那会把 `REFERENCES` / `OR` 当成列名，也会漏掉
 * 后来被 0025 DROP 掉的 `learned_kp_count`（我的第一版就是这 4 处假阳性）。
 * 权威口径是：**在临时 schema 上把全部迁移跑一遍**，拿这份「代码要求的形状」
 * 与真实库的 app schema 逐表逐列做差集。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
const requireApi = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
const { Client } = requireApi('pg');

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap';
const fresh = 'app_t75_fresh_' + randomBytes(4).toString('hex');

const { migrateUp } = await import('../../apps/api/src/db/migrate.ts').catch(async () => {
  // node 直接 import .ts 在同进程内可用（node 26 原生剥离）
  return await import('../../apps/api/src/db/migrate.js');
});

const res = await migrateUp({ databaseUrl: URL, schema: fresh, log: () => {} });
console.log(`临时 schema ${fresh}：应用了 ${res.applied.length} 个迁移`);

const c = new Client({ connectionString: URL });
await c.connect();
const shape = async (s) => {
  const t = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE'", [s]);
  const col = await c.query("SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema=$1", [s]);
  const idx = await c.query("SELECT indexname FROM pg_indexes WHERE schemaname=$1", [s]);
  const key = new Map();
  for (const r of col.rows) key.set(`${r.table_name}.${r.column_name}`, `${r.data_type}/${r.is_nullable}`);
  return {
    tables: new Set(t.rows.map(r => r.table_name)),
    columns: key,
    indexes: new Set(idx.rows.map(r => r.indexname)),
  };
};

const want = await shape(fresh);   // 代码要求的形状
const have = await shape('app');    // 真实库的形状

const missT = [...want.tables].filter(x => !have.tables.has(x)).sort();
const missC = [...want.columns.keys()].filter(x => !have.columns.has(x)).sort();
const typeDiff = [...want.columns].filter(([k, v]) => have.columns.has(k) && have.columns.get(k) !== v)
  .map(([k, v]) => `${k}: 迁移=${v} 库=${have.columns.get(k)}`).sort();
const extraT = [...have.tables].filter(x => !want.tables.has(x)).sort();
const extraC = [...have.columns.keys()].filter(x => !want.columns.has(x)).sort();

console.log(`\n代码要求的形状：表 ${want.tables.size} 个、列 ${want.columns.size} 个`);
console.log(`真实库 app：表 ${have.tables.size} 个、列 ${have.columns.size} 个`);
console.log(`\n【代码要、库里没有】表：${missT.length} 处`);
missT.forEach(x => console.log('  - ' + x));
console.log(`【代码要、库里没有】列：${missC.length} 处`);
missC.forEach(x => console.log('  - ' + x));
console.log(`【类型/可空性不一致】：${typeDiff.length} 处`);
typeDiff.forEach(x => console.log('  - ' + x));
console.log(`\n（参考）库里多出来的表：${extraT.length} 处 → ${extraT.join(', ') || '无'}`);
console.log(`（参考）库里多出来的列：${extraC.length} 处 → ${extraC.join(', ') || '无'}`);

await c.query(`DROP SCHEMA IF EXISTS ${fresh} CASCADE`);
await c.end();
