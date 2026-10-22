/** 库里哪些知识点有关卡（S2 的 level_card 只在有 level 时产出）。 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/starmap',
});
await client.connect();
const rows = await client.query(
  `SELECT l.id, l.micro_kp_id, l.title, l.ordinal,
          (SELECT count(*) FROM app.level_items i WHERE i.level_id = l.id) AS items,
          kp.name, kp.is_leaf
     FROM app.levels l JOIN app.knowledge_points kp ON kp.id = l.micro_kp_id
    ORDER BY l.micro_kp_id, l.ordinal`,
);
console.table(rows.rows);
await client.end();
