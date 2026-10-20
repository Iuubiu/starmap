import io
import json
import re
from collections import defaultdict

toc = json.load(io.open('content/digital-kanghua-5e/toc.json', encoding='utf-8'))['nodes']
rows = [json.loads(l) for l in io.open('content/digital-kanghua-5e/chunks.jsonl', encoding='utf-8')]

page_of = {n['microKpId']: n['printedPage'] for n in toc}
num_to_id = {n['num']: n['microKpId'] for n in toc if n.get('num')}

leaves_of = defaultdict(set)
for n in toc:
    if not n['isLeaf']:
        continue
    parts = (n.get('num') or '').split('.')
    for k in range(1, len(parts) + 1):
        leaves_of['.'.join(parts[:k])].add(n['microKpId'])

SECTION = re.compile(r'(\d{1,2}(?:\.\d{1,2}){1,2})\s*节')
FORMULA = re.compile(r'式\s*[\(（]\s*(\d{1,2}(?:\.\d{1,2}){1,2})')

edges = defaultdict(list)
stats = defaultdict(int)

for r in rows:
    owner = r.get('micro_kp_id')
    if not owner:
        continue
    own_page = r['printed_page']
    for label, rx in (('section', SECTION), ('formula', FORMULA)):
        for m in rx.finditer(r['text']):
            num = m.group(1)
            if num not in page_of:
                stats[f'{label}:unknown'] += 1
                continue
            tgt = num_to_id.get(num)
            if tgt is None:
                stats[f'{label}:no-node'] += 1
                continue
            if page_of[tgt] >= own_page:
                stats[f'{label}:forward'] += 1
                continue
            leaves = leaves_of.get(num, set())
            if not leaves:
                stats[f'{label}:no-leaf'] += 1
                continue
            for leaf in leaves:
                if leaf == owner:
                    stats[f'{label}:self'] += 1
                    continue
                edges[(leaf, owner)].append((label, m.group(0), own_page))

print('distinct edges', len(edges), 'pairs', sum(len(v) for v in edges.values()))
print('stats', dict(stats))

chaps = {n['microKpId']: n['num'] for n in toc if n['depth'] == 1}
cross = sum(1 for (a, b) in edges if chaps.get(a) != chaps.get(b))
print('cross-chapter edges', cross, '/', len(edges))

# 连通性
adj = defaultdict(set)
for (a, b) in edges:
    adj[a].add(b)
roots = [b for (a, b) in edges if not any(b == x for (_, x) in edges)]
print('nodes with outgoing', len(adj))
