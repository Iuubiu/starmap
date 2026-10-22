import pg from 'pg';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap' });
await db.connect();
// 1) 根/浅层节点里名字可疑的
const r = await db.query(`
  SELECT id, name, is_leaf, depth, source_id
    FROM app.knowledge_points
   WHERE depth <= 1
     AND (name ~ '^(上册|下册|中册|目录|目次|附录|附录[A-Z]?|索引|前言|序言|绪论|内容简介|出版说明)$'
          OR name ~ '(目录|上册|下册|中册)$'
          OR name ILIKE '%豐%' OR name ILIKE '%丰录%')
   ORDER BY depth, source_id, id`);
console.log('SUSPECT-SHALLOW', r.rows.length);
console.log(JSON.stringify(r.rows, null, 1));
await db.end();
