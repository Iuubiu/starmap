import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

const requireApi = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
const { Client } = requireApi('pg');
const DIR = join(process.cwd(), 'apps', 'api', 'migrations');
const URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap';

const files = readdirSync(DIR).filter(f => f.endsWith('.sql') && !f.endsWith('.down.sql') && !f.startsWith('seed')).sort();

/** 剥注释，避免把注释里的示例当真 */
const strip = (sql) => sql.replace(/--[^\n]*/g, '');

const tables = new Map();   // table -> [file]
const columns = new Map();  // table.col -> [file]

for (const f of files) {
  const sql = strip(readFileSync(join(DIR, f), 'utf8'));
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:app\.)?([a-z_0-9]+)/gi)) {
    if (!tables.has(m[1])) tables.set(m[1], []);
    tables.get(m[1]).push(f);
  }
  // 表内列定义（只抓 CREATE TABLE 块内的）
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:app\.)?([a-z_0-9]+)\s*\(([\s\S]*?)\n\)/gi)) {
    const t = m[1];
    for (const line of m[2].split('\n')) {
      const c = /^\s*([a-z_0-9]+)\s+(?!KEY|PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|CHECK)/i.exec(line);
      if (c && !/^(primary|foreign|unique|constraint|check|key)$/i.test(c[1])) {
        const key = `${t}.${c[1]}`;
        if (!columns.has(key)) columns.set(key, []);
        columns.get(key).push(f);
      }
    }
  }
  for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:app\.)?([a-z_0-9]+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_0-9]+)/gi)) {
    const key = `${m[1]}.${m[2]}`;
    if (!columns.has(key)) columns.set(key, []);
    columns.get(key).push(f);
  }
}

const c = new Client({ connectionString: URL });
await c.connect();
const t = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema='app'");
const haveT = new Set(t.rows.map(r => r.table_name));
const col = await c.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='app'");
const haveC = new Set(col.rows.map(r => `${r.table_name}.${r.column_name}`));

const missT = [...tables].filter(([n]) => !haveT.has(n)).map(([n, f]) => `${n}  (${f.join(', ')})`);
const missC = [...columns].filter(([n]) => !haveC.has(n)).map(([n, f]) => `${n}  (${f.join(', ')})`);

console.log(`迁移文件 ${files.length} 个；声明表 ${tables.size} 个；声明列 ${columns.size} 个`);
console.log(`真实库 app schema：表 ${haveT.size} 个、列 ${haveC.size} 个`);
console.log(`\n【代码要、库里没有】表：${missT.length} 处`);
missT.forEach(x => console.log('  - ' + x));
console.log(`【代码要、库里没有】列：${missC.length} 处`);
missC.forEach(x => console.log('  - ' + x));
await c.end();
