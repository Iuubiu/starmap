"""t24 第一件：把 knowledge_points 的**全部**外键引用点（不只 captain 列的 8 个）都查一遍。
captain 的清单是几小时前的；期间 t27（video_clips）、t29（review_round_items）都建了新表。"""
import json, subprocess, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

IDS = [l.strip() for l in open('.scratch/t17/stale2.txt', encoding='utf-8') if l.strip()]
a = 'ARRAY[' + ','.join("'" + i + "'" for i in IDS) + ']::text[]'

def q(sql):
    o = subprocess.run(['node', '.scratch/t17/q.mjs', sql], capture_output=True, text=True, encoding='utf-8')
    if o.returncode != 0: raise SystemExit('SQL 失败: ' + o.stderr[:500])
    return [json.loads(l) for l in o.stdout.splitlines() if l.strip().startswith('{') and l.startswith('{"')]

# 动态列举所有指向 knowledge_points 的外键列
fks = q("""select c.conrelid::regclass::text as tbl, a.attname as col
             from pg_constraint c
             join lateral unnest(c.conkey) k(attnum) on true
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
            where c.contype = 'f' and c.confrelid = 'app.knowledge_points'::regclass
            order by 1, 2""")
print(f'指向 app.knowledge_points 的外键列共 {len(fks)} 个：')
bad = []
for fk in fks:
    tbl = fk['tbl'].replace('app.', '')
    col = fk['col']
    # jsonb spec->meta->>microKpId 不是外键，单独查
    n = int(q(f'select count(*) as n from app.{tbl} where {col} = ANY({a})')[0]['n'])
    mark = '' if n == 0 else '  ← 非 0！'
    print(f'  {tbl+"."+col:44s} {n:>5}{mark}')
    if n:
        bad.append((f'{tbl}.{col}', n))

# 非外键的 JSONB / text 位置
EXTRA = [
    ('levels.spec->meta->>microKpId',
     f"select count(*) as n from app.levels where spec->'meta'->>'microKpId' = ANY({a})"),
    ('level_items.source_ref (text, 无外键)',
     f"select count(*) as n from app.level_items where source_ref = ANY({a})"),
]
print('\nJSONB / 无外键位置：')
for label, sql in EXTRA:
    n = int(q(sql)[0]['n'])
    print(f'  {label:44s} {n:>5}' + ('' if n == 0 else '  ← 非 0！'))
    if n:
        bad.append((label, n))

print('\n结论：', '全部为 0，可以安全删除' if not bad else f'✗ 非 0：{bad} —— 停手报 captain')
