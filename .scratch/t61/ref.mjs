// 只读：统计 B 类碎片节点在各表的引用。字面量写在源文件里（UTF-8），不经 argv。
import { createRequire } from 'node:module';
import { join } from 'node:path';

const req = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
const { Client } = req('pg');

const FRAG = 'kp-dinghonglin-2010-p1-作用与地位';
const KEEPER = 'kp-dinghonglin-2010-1-1';

const TABLES = [
  'chunks',
  'chunk_kp_answer',
  'attempts',
  'mastery',
  'learning_log',
  'levels',
  'probe_sessions',
  'review_round_items',
  'video_clips',
  'agent_turns',
  'level_generation_task',
];

const client = new Client({
  connectionString: 'postgres://postgres@127.0.0.1:5432/starmap',
});
await client.connect();

const rows = [];
for (const table of TABLES) {
  const r = await client.query(
    `SELECT count(*)::int AS n FROM app.${table} WHERE micro_kp_id = $1`,
    [FRAG],
  );
  rows.push([table, r.rows[0].n]);
}
const extra = [
  ['kp_edges', 'SELECT count(*)::int AS n FROM app.kp_edges WHERE from_id = $1 OR to_id = $1'],
  ['children', 'SELECT count(*)::int AS n FROM app.knowledge_points WHERE parent_id = $1'],
  [
    'node_unlocks',
    'SELECT count(*)::int AS n FROM app.node_unlocks WHERE node_id = $1 OR prerequisite_id = $1',
  ],
];
for (const [label, sql] of extra) {
  const r = await client.query(sql, [FRAG]);
  rows.push([label, r.rows[0].n]);
}
for (const [label, sql] of [
  ['keeper_chunks', 'SELECT count(*)::int AS n FROM app.chunks WHERE micro_kp_id = $1'],
  ['keeper_cka', 'SELECT count(*)::int AS n FROM app.chunk_kp_answer WHERE micro_kp_id = $1'],
]) {
  const r = await client.query(sql, [KEEPER]);
  rows.push([label, r.rows[0].n]);
}
await client.end();

for (const [label, n] of rows) console.log(`${label.padEnd(24)} ${n}`);
