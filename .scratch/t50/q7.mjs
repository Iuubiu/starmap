import { createRequire } from 'node:module';
import { join } from 'node:path';
const requireApi = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
const { Client } = requireApi('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap', options: '-c search_path=app,public' });
await c.connect();
// 更宽的首字符集合
const wide = await c.query(`SELECT id, source_id, name, source_page FROM knowledge_points
  WHERE substr(name,1,1) IN ('、','，','。','；','：','）',')',']','】','·','—','－','-','/','·')
  ORDER BY source_id, source_page`);
console.log('宽口径 count =', wide.rowCount);
for (const x of wide.rows) console.log(' ', JSON.stringify(x.name), '|', x.source_id, '|', x.id);

// 名字里第一个字符不是中文/字母/数字的
const nonword = await c.query(`SELECT id, source_id, name, source_page FROM knowledge_points
  WHERE name !~ '^[0-9A-Za-z\u4e00-\u9fff（(第]'
  ORDER BY source_id, source_page`);
console.log('\n首字符非中英文数字 count =', nonword.rowCount);
for (const x of nonword.rows) console.log(' ', JSON.stringify(x.name), '|', x.source_id);
await c.end();
