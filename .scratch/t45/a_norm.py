import json, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0,'tools/ingest')
from translate import _strip_number, _normalize
CONTENT = Path('content')
real=[]
for p in sorted(CONTENT.glob('*/toc.json')):
    sid=p.parent.name
    nodes=json.loads(p.read_text(encoding='utf-8')).get('nodes',[])
    by={}
    for n in nodes:
        nm=n.get('name') or ''
        orig=_normalize(_strip_number((n.get('nameOriginal') or '').strip())).lower()
        by.setdefault(nm,set()).add(orig)
    for nm,origs in by.items():
        if len(origs)>1:
            real.append((sid,nm,sorted(origs)))
print('real collapse groups (num 归一 + 小写后仍不同):', len(real))
for sid,nm,o in real: print(f'  {sid:25s} {nm!r} <- {o}')
