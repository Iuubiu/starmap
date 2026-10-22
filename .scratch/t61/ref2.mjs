// 只读：B 类碎片节点上挂的 probe_sessions / agent_turns 时间与内容。
import { createRequire } from 'node:module';
import { join } from 'node:path';

const req = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
const { Client } = req('pg');

const FRAG = 'kp-dinghonglin-2010-p1-作用与地位';

const client = new Client({
  connectionString: 'postgres://postgres@127.0.0.1:5432/starmap',
});
await client.connect();

const ps = await client.query(
  `SELECT id, session_id, tier, turns, created_at, updated_at
     FROM app.probe_sessions WHERE micro_kp_id = $1 ORDER BY created_at`,
  [FRAG],
);
console.log('probe_sessions:', ps.rows.length);
for (const r of ps.rows) console.log('  ', r.id, r.tier, r.turns, String(r.created_at));

const at = await client.query(
  `SELECT id, session_id, ordinal, artifact_kind, left(utterance, 40) AS u, created_at
     FROM app.agent_turns WHERE micro_kp_id = $1 ORDER BY created_at`,
  [FRAG],
);
console.log('agent_turns:', at.rows.length);
for (const r of at.rows)
  console.log('  ', r.id, r.artifact_kind, JSON.stringify(r.u), String(r.created_at));

const ch = await client.query(
  `SELECT min(page) AS lo, max(page) AS hi, count(*)::int AS n
     FROM app.chunks WHERE micro_kp_id = $1`,
  [FRAG],
);
console.log('frag chunks page range:', ch.rows[0]);

const keeper = await client.query(
  `SELECT min(page) AS lo, max(page) AS hi, count(*)::int AS n
     FROM app.chunks WHERE micro_kp_id = 'kp-dinghonglin-2010-1-1'`,
);
console.log('keeper chunks page range:', keeper.rows[0]);

await client.end();
