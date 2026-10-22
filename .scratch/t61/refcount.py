"""统计 B 类碎片节点在各表的引用（只读）。用 node + pg 避开 Windows 控制台编码问题。"""
import io
import json
import subprocess
import sys

FRAG = 'kp-dinghonglin-2010-p1-作用与地位'
KEEPER = 'kp-dinghonglin-2010-1-1'

TABLES = [
    ('chunks', 'micro_kp_id'),
    ('chunk_kp_answer', 'micro_kp_id'),
    ('attempts', 'micro_kp_id'),
    ('mastery', 'micro_kp_id'),
    ('learning_log', 'micro_kp_id'),
    ('levels', 'micro_kp_id'),
    ('probe_sessions', 'micro_kp_id'),
    ('review_round_items', 'micro_kp_id'),
    ('video_clips', 'micro_kp_id'),
    ('agent_turns', 'micro_kp_id'),
    ('level_generation_task', 'micro_kp_id'),
]

lines = []
for table, col in TABLES:
    lines.append(
        f"SELECT '{table}' AS t, count(*)::int AS n FROM app.{table} WHERE {col} = $1;"
    )
lines.append(
    "SELECT 'kp_edges' AS t, count(*)::int AS n FROM app.kp_edges WHERE from_id = $1 OR to_id = $1;"
)
lines.append(
    "SELECT 'children' AS t, count(*)::int AS n FROM app.knowledge_points WHERE parent_id = $1;"
)
lines.append(
    "SELECT 'node_unlocks' AS t, count(*)::int AS n FROM app.node_unlocks WHERE node_id = $1 OR prerequisite_id = $1;"
)
lines.append(
    "SELECT 'keeper_chunks' AS t, count(*)::int AS n FROM app.chunks WHERE micro_kp_id = $2;"
)
lines.append(
    "SELECT 'keeper_cka' AS t, count(*)::int AS n FROM app.chunk_kp_answer WHERE micro_kp_id = $2;"
)

script = """
const { createRequire } = require('node:module');
const { join } = require('node:path');
const req = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
const { Client } = req('pg');
const queries = JSON.parse(process.argv[2]);
const frag = process.argv[3];
const keeper = process.argv[4];
(async () => {
  const c = new Client({ connectionString: 'postgres://postgres@127.0.0.1:5432/starmap' });
  await c.connect();
  const out = [];
  for (const q0 of queries) {
    const idx = [...q0.matchAll(/\\$(\\d+)/g)].map((m) => Number(m[1]));
    const maxIdx = idx.length ? Math.max(...idx) : 0;
    const params = [frag, keeper].slice(0, maxIdx);
    const q = q0.replace(/\\$(\\d+)/g, '$$$1::text');
    const r = await c.query(q, params);
    out.push(r.rows[0]);
  }
  await c.end();
  process.stdout.write(JSON.stringify(out));
})().catch((e) => { console.error(e); process.exit(1); });
"""

io.open('.scratch/t61/refcount.cjs', 'w', encoding='utf-8').write(script)
proc = subprocess.run(
    ['node', '.scratch/t61/refcount.cjs', json.dumps(lines), FRAG, KEEPER],
    capture_output=True,
    text=True,
    encoding='utf-8',
)
if proc.returncode != 0:
    print('FAILED', proc.stderr)
    sys.exit(1)
for row in json.loads(proc.stdout):
    print(f"{row['t']:24s} {row['n']}")
