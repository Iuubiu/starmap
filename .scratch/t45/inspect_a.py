import json, sys, collections
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
CONTENT = Path('content')
groups = []
for toc_path in sorted(CONTENT.glob('*/toc.json')):
    toc = json.loads(toc_path.read_text(encoding='utf-8'))
    sid = toc.get('sourceId') or toc_path.parent.name
    by = collections.defaultdict(list)
    for n in toc.get('nodes', []):
        by[(n.get('name') or '').strip()].append(n)
    for name, ns in by.items():
        origs = {(n.get('nameOriginal') or '').strip() for n in ns}
        if len(origs) > 1:
            groups.append((sid, name, sorted(origs)))
print('groups:', len(groups), 'nodes:', sum(len(g[2]) for g in groups))
for sid, name, origs in groups:
    print(f'{sid} | {name!r} <- {origs}')
