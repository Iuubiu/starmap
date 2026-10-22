"""验证 parent_id 的 8 条引用是不是 captain 说的「2 个过期非叶节点的子节点，且子节点也全过期」。"""
import json, subprocess, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
IDS = [l.strip() for l in open('.scratch/t17/stale2.txt', encoding='utf-8') if l.strip()]
idset = set(IDS)
a = 'ARRAY[' + ','.join("'" + i + "'" for i in IDS) + ']::text[]'

def q(sql):
    o = subprocess.run(['node', '.scratch/t17/q.mjs', sql], capture_output=True, text=True, encoding='utf-8')
    if o.returncode != 0: raise SystemExit('SQL 失败: ' + o.stderr[:500])
    return [json.loads(l) for l in o.stdout.splitlines() if l.strip().startswith('{') and l.startswith('{"')]

rows = q(f"""select k.id, k.name, k.depth, k.parent_id, k.is_leaf, k.source_id
               from app.knowledge_points k
              where k.parent_id = ANY({a})
              order by k.parent_id, k.id""")
print(f'父在幽灵集里的子节点 {len(rows)} 个：')
all_stale = True
for r in rows:
    in_stale = r['id'] in idset
    all_stale &= in_stale
    print(f"  {r['id']:44s} parent={r['parent_id']:28s} d={r['depth']} leaf={r['is_leaf']} "
          f"{'★也在幽灵集里' if in_stale else '✗ 不在幽灵集里！'}  {r['name']!r}")
print('\n所有子节点都也在幽灵集里：', all_stale)

# 反过来：幽灵集里的非叶节点有哪些，各自 children 数
nl = q(f"""select k.id, k.name, k.depth, k.is_leaf,
                  (select count(*) from app.knowledge_points c where c.parent_id = k.id) as kids
             from app.knowledge_points k where k.id = ANY({a}) and k.is_leaf = false
             order by kids desc, k.id""")
print(f'\n幽灵集里的非叶节点 {len(nl)} 个：')
for r in nl:
    kids = int(r['kids'])
    mark = '  ← 有子节点' if kids else ''
    print(f"  {r['id']:44s} d={r['depth']} kids={kids}{mark}  {r['name']!r}")
