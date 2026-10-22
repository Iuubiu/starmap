"""t24 第一件：从当前 DB + content/*/toc.json 重新推导幽灵知识点集合，
并与 captain 的 .scratch/t17/stale2.txt 对照（captain 的取证是几小时前的，我重导过）。"""
import glob, json, os, subprocess, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

def q(sql):
    o = subprocess.run(['node', '.scratch/t17/q.mjs', sql], capture_output=True, text=True, encoding='utf-8')
    if o.returncode != 0: raise SystemExit('SQL 失败: ' + o.stderr[:400])
    return [json.loads(l) for l in o.stdout.splitlines() if l.strip().startswith('{') and l.startswith('{"')]

# 1. 每个 toc.json 的 id 集合
toc_ids = {}
for p in sorted(glob.glob('content/*/toc.json')):
    sid = os.path.basename(os.path.dirname(p))
    toc = json.load(open(p, encoding='utf-8'))
    toc_ids[sid] = {n['microKpId'] for n in toc['nodes']}
all_toc = set().union(*toc_ids.values())

# 2. DB 全量
rows = q('select id, name, depth, parent_id, is_leaf, source_id from app.knowledge_points order by source_id, id')
print(f'DB knowledge_points 共 {len(rows)} 行')
by_src = {}
for r in rows:
    by_src.setdefault(r['source_id'], []).append(r)

print(f"\n{'sourceId':46s} {'toc.json':>8} {'DB':>5} {'差':>4}")
mismatch = 0
for sid in sorted(toc_ids):
    n_toc = len(toc_ids[sid]); n_db = len(by_src.get(sid, []))
    flag = '' if n_toc == n_db else '  ←'
    if n_toc != n_db: mismatch += 1
    print(f'{sid:46s} {n_toc:>8} {n_db:>5} {n_db - n_toc:>4}{flag}')

ghost = [r for r in rows if r['id'] not in all_toc]
seed  = [r for r in ghost if not r['source_id']]
real_ghost = [r for r in ghost if r['source_id']]
print(f'\n任何 toc.json 都没有的：{len(ghost)} 行（其中 source_id 为 NULL 的 seed {len(seed)} 个，真幽灵 {len(real_ghost)} 个）')
for r in seed:
    print(f"  [SEED 不能删] {r['id']:24s} {r['name']!r} d={r['depth']} leaf={r['is_leaf']} src={r['source_id']}")

old = {l.strip() for l in open('.scratch/t17/stale2.txt', encoding='utf-8') if l.strip()}
new = {r['id'] for r in real_ghost}
print(f'\ncaptain stale2.txt {len(old)} 个；我重新推导 {len(new)} 个')
print('  两者相同：', 'YES' if old == new else 'NO')
if old - new: print('  captain 有我没有（已被之前重导清掉？）：', len(old - new), sorted(old - new)[:8])
if new - old: print('  我有 captain 没有（重导新产生）：', len(new - old), sorted(new - old)[:8])

json.dump([{'id': r['id'], 'name': r['name'], 'depth': r['depth'], 'parent_id': r['parent_id'],
            'is_left': r['is_leaf'], 'source_id': r['source_id']} for r in real_ghost],
          open('.scratch/t24/ghost.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('\n已写 .scratch/t24/ghost.json')

# 3. 按书 + name 形态分组（报告要写「这 156 行是哪几次重跑留下的」）
from collections import Counter, defaultdict
print('\n=== 按书统计 ===')
for sid, n in Counter(r['source_id'] for r in real_ghost).most_common():
    print(f'  {sid:46s} {n:3d}')
print('\n=== name 形态（前 20 个最常见的） ===')
for name, n in Counter(r['name'] for r in real_ghost).most_common(20):
    print(f'  {name!r:52s} {n}')
