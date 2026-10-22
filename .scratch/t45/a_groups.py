import json, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
CONTENT = Path('content')
for p in sorted(CONTENT.glob('*/toc.json')):
    sid = p.parent.name
    nodes = json.loads(p.read_text(encoding='utf-8')).get('nodes', [])
    by = {}
    for n in nodes:
        by.setdefault(n.get('name') or '', set()).add((n.get('nameOriginal') or '').strip())
    for nm, origs in by.items():
        if len(origs) > 1:
            print(f'{sid:45s} {nm!r} <- {sorted(origs)}')
