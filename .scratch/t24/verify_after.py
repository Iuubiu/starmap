"""t24 第一件：删后复验。"""
import glob, json, os, subprocess, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

def q(sql):
    o = subprocess.run(['node', '.scratch/t17/q.mjs', sql], capture_output=True, text=True, encoding='utf-8')
    if o.returncode != 0: raise SystemExit('SQL 失败: ' + o.stderr[:500])
    return [json.loads(l) for l in o.stdout.splitlines() if l.strip().startswith('{') and l.startswith('{"')]

IDS = [l.strip() for l in open('.scratch/t17/stale2.txt', encoding='utf-8') if l.strip()]
a = 'ARRAY[' + ','.join("'" + i + "'" for i in IDS) + ']::text[]'

n_kp = int(q('select count(*) as n from app.knowledge_points')[0]['n'])
n_ghost = int(q(f'select count(*) as n from app.knowledge_points where id = ANY({a})')[0]['n'])
print(f'knowledge_points 总数：2596 → {n_kp}（期望 2440 = 2596-156）')
print(f'156 个幽灵在库内还剩：{n_ghost}（期望 0）')

print(f"\n{'sourceId':46s} {'toc.json':>8} {'DB':>5} {'1:1':>5}")
toc_ids = {}
for p in sorted(glob.glob('content/*/toc.json')):
    sid = os.path.basename(os.path.dirname(p))
    toc_ids[sid] = {n['microKpId'] for n in json.load(open(p, encoding='utf-8'))['nodes']}
db = {r['source_id']: int(r['n']) for r in q('select source_id, count(*) as n from app.knowledge_points group by 1')}
allok = True
for sid in sorted(toc_ids):
    ok = len(toc_ids[sid]) == db.get(sid, 0)
    allok &= ok
    print(f'{sid:46s} {len(toc_ids[sid]):>8} {db.get(sid, 0):>5} {"✓" if ok else "✗"}')
print('全 12 本 toc.json nodeCount == DB 节点数：', 'YES' if allok else 'NO')

# 任何 toc.json 都没有的（应只剩 3 个 seed）
all_toc = set().union(*toc_ids.values())
extra = q('select id, name, source_id from app.knowledge_points')
left = [r for r in extra if r['id'] not in all_toc]
print(f'\n仍不在任何 toc.json 里：{len(left)} 行（期望 3 个 seed）')
for r in left:
    print(f"  {r['id']:16s} {r['name']!r} src={r['source_id']}")

# 孤儿检查
orph = q("""select count(*) as n from app.knowledge_points k
             where k.parent_id is not null
               and not exists (select 1 from app.knowledge_points p where p.id = k.parent_id)""")
print('\nparent_id 指向不存在的行：', orph[0]['n'])
# chunk 归属完整性
miss = q("""select count(*) as n from app.chunks c
             where c.micro_kp_id is not null
               and not exists (select 1 from app.knowledge_points k where k.id = c.micro_kp_id)""")
print('chunks->missing kp：', miss[0]['n'])
