import json, subprocess, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
IDS = ['kp-lihansun-5e-vol1-p2-上册','kp-yanshi-6e-p1-绪论','kp-wangzhiying-1989-p1-目電录',
       'kp-wangzhiying-1989-p1-绪论','kp-jichangsong-1990-p1-概念与术语']
a = 'ARRAY[' + ','.join("'" + i + "'" for i in IDS) + ']::text[]'
def q(sql):
    o = subprocess.run(['node','.scratch/t17/q.mjs',sql],capture_output=True,text=True,encoding='utf-8')
    return [json.loads(l) for l in o.stdout.splitlines() if l.strip().startswith('{') and l.startswith('{"')]
rows = q(f"""select k.id, k.name, k.depth, k.is_leaf, k.module_id, k.ordinal, k.source_page,
                    (select count(*) from app.chunks c where c.micro_kp_id = k.id) as chunks,
                    (select count(*) from app.knowledge_points x where x.parent_id = k.id) as kids,
                    (select count(*) from app.kp_edges e where e.to_id = k.id) as in_edges,
                    (select count(*) from app.levels l where l.micro_kp_id = k.id) as levels,
                    (select count(*) from app.attempts t where t.micro_kp_id = k.id) as attempts
               from app.knowledge_points k where k.id = ANY({a}) order by k.id""")
print(f'{"id":38s} {"name":10s} {"d":>2} {"leaf":>5} {"chunks":>6} {"kids":>4} {"inedge":>6} {"lv":>3} {"att":>4}')
for r in rows:
    print(f"{r['id']:38s} {r['name']:10s} {r['depth']:>2} {str(r['is_leaf']):>5} {r['chunks']:>6} {r['kids']:>4} {r['in_edges']:>6} {r['levels']:>3} {r['attempts']:>4}")
print('\nrows', len(rows))
