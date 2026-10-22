import json, subprocess, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
def q(sql):
    o = subprocess.run(['node','.scratch/t17/q.mjs',sql],capture_output=True,text=True,encoding='utf-8')
    if o.returncode != 0: raise SystemExit(o.stderr[:500])
    return [json.loads(l) for l in o.stdout.splitlines() if l.strip().startswith('{') and l.startswith('{"')]

print('=== kp-bool 的关卡 ===')
for r in q("""select l.id, l.title, l.spec->'meta'->>'microKpId' as kp,
                     (select count(*) from app.level_items li where li.level_id=l.id) as items
                from app.levels l where l.spec->'meta'->>'microKpId' = 'kp-bool'"""):
    print(' ', r)

print('\n=== 零 chunk 叶节点统计 ===')
rows = q("""select n.id, n.name, n.depth, m.ordinal as mo,
                   (select count(*) from app.chunks c where c.micro_kp_id = n.id) as chunks,
                   (select count(*) from app.level_items li join app.levels l on l.id = li.level_id
                     where l.spec->'meta'->>'microKpId' = n.id) as items
              from app.knowledge_points n join app.modules m on m.id = n.module_id
             where n.is_leaf = true
             order by n.depth, m.ordinal, n.id""")
zero = [r for r in rows if int(r['chunks']) == 0]
print(f'叶节点总数 {len(rows)}，零 chunk 的 {len(zero)} 个：')
for r in zero:
    keep = ' ← 有关卡，必须保留' if int(r['items']) else ''
    print(f"  d{r['depth']} mo={r['mo']:>2} {r['id']:52s} items={r['items']}{keep} {r['name']!r}")

n_chunk = sum(1 for r in rows if int(r['chunks']) > 0)
n_items = sum(1 for r in rows if int(r['items']) > 0)
print(f'\n有 chunk 的叶 {n_chunk}；有关卡的叶 {n_items}；两者并集（新候选集大小）', end=' ')
u = {r['id'] for r in rows if int(r['chunks']) > 0 or int(r['items']) > 0}
print(len(u))
