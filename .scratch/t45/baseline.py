import json, re, sys, collections
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = Path('.')
CONTENT = ROOT / 'content'

groups = 0
nodes_in_groups = 0
per_book = collections.Counter()
total_nodes = 0
bad_num = []
for toc_path in sorted(CONTENT.glob('*/toc.json')):
    toc = json.loads(toc_path.read_text(encoding='utf-8'))
    sid = toc.get('sourceId') or toc_path.parent.name
    by_name = collections.defaultdict(set)
    for n in toc.get('nodes', []):
        total_nodes += 1
        name = (n.get('name') or '').strip()
        orig = (n.get('nameOriginal') or '').strip()
        if name and orig:
            by_name[name].add(orig)
        num = (n.get('num') or '').strip()
        if num and name.startswith(num + ' '):
            bad_num.append((sid, n.get('microKpId'), name, num, orig))
    for name, origs in by_name.items():
        if len(origs) > 1:
            groups += 1
            nodes_in_groups += len(origs)
            per_book[sid] += len(origs)

print(f'total nodes: {total_nodes}')
print(f'A collapse groups: {groups}  nodes involved: {nodes_in_groups}')
for sid, c in per_book.most_common():
    print(f'   {sid}: {c}')
print(f'B name starts with own num: {len(bad_num)}')
bc = collections.Counter(x[0] for x in bad_num)
for sid, c in bc.most_common():
    print(f'   {sid}: {c}')
