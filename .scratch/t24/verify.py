"""t24 第一件复核：156 个幽灵知识点在当前时刻是否仍被任何引用表引用。"""
import json, subprocess, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

IDS = [l.strip() for l in open('.scratch/t17/stale2.txt', encoding='utf-8') if l.strip()]
print(f'stale2.txt 行数 {len(IDS)}，去重后 {len(set(IDS))}')

def arr(ids):
    return 'ARRAY[' + ','.join("'" + i + "'" for i in ids) + ']::text[]'

def q(sql):
    o = subprocess.run(['node', '.scratch/t17/q.mjs', sql], capture_output=True, text=True, encoding='utf-8')
    if o.returncode != 0:
        raise SystemExit('SQL 失败: ' + o.stderr[:400])
    return [json.loads(l) for l in o.stdout.splitlines() if l.strip().startswith('{') and l.startswith('{"')]

a = arr(IDS)
CHECKS = [
    ('attempts.micro_kp_id', f'select count(*) as n from app.attempts where micro_kp_id = ANY({a})'),
    ('mastery.micro_kp_id', f'select count(*) as n from app.mastery where micro_kp_id = ANY({a})'),
    ('levels.spec.meta', f"select count(*) as n from app.levels where spec->'meta'->>'microKpId' = ANY({a})"),
    ('level_generation_task', f'select count(*) as n from app.level_generation_task where micro_kp_id = ANY({a})'),
    ('node_unlocks.node_id', f'select count(*) as n from app.node_unlocks where node_id = ANY({a})'),
    ('node_unlocks.prereq', f'select count(*) as n from app.node_unlocks where prerequisite_id = ANY({a})'),
    ('probe_sessions', f'select count(*) as n from app.probe_sessions where micro_kp_id = ANY({a})'),
    ('agent_turns', f'select count(*) as n from app.agent_turns where micro_kp_id = ANY({a})'),
    ('chunk_kp_answer', f'select count(*) as n from app.chunk_kp_answer where micro_kp_id = ANY({a})'),
    ('placement_answers', f'select count(*) as n from app.placement_answers where micro_kp_id = ANY({a})'),
    ('chunks.micro_kp_id', f'select count(*) as n from app.chunks where micro_kp_id = ANY({a})'),
    ('kp_edges.from_id', f'select count(*) as n from app.kp_edges where from_id = ANY({a})'),
    ('kp_edges.to_id', f'select count(*) as n from app.kp_edges where to_id = ANY({a})'),
]
bad = []
print('\n=== 156 个幽灵在 13 个引用位置的命中数 ===')
for label, sql in CHECKS:
    n = int(q(sql)[0]['n'])
    mark = '' if n == 0 else '  ← 非 0！'
    print(f'  {label:26s} {n:>5}{mark}')
    if n:
        bad.append((label, n))

print('\n=== 这 156 个 id 是否仍然存在于 knowledge_points ===')
have = q(f"select count(*) as n from app.knowledge_points where id = ANY({a})")
print('  仍在库内：', have[0]['n'], '/', len(IDS))
print('\n=== 无 id 条件的删除禁令自检 ===')
print('  下面的事务只用 WHERE id = ANY(...)；不使用 TRUNCATE / 不带 WHERE 的 DELETE。')
print('\n结论：', '全部为 0，可以删' if not bad else f'✗ 非 0：{bad} —— 停手报 captain')
