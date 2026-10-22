import io, json, sys, collections
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(Path('tools/ingest').resolve()))
import translate as T

CONTENT = Path('content')
def load(p): return json.load(io.open(p, encoding='utf-8'))

for p in sorted(CONTENT.glob('*/toc.json')):
    d = load(p); sid = d.get('sourceId') or p.parent.name
    byname = collections.defaultdict(list)
    for n in d.get('nodes', []):
        byname[n.get('name') or ''].append(n)
    shown = False
    for name, ns in byname.items():
        origs = { (n.get('nameOriginal') or '') for n in ns }
        if len(origs) < 2: continue
        if not shown:
            print(f'##### {sid}'); shown = True
        print(f'  [{name}]')
        for o in sorted(origs):
            if not o: continue
            T._MISSING.clear()
            out = T.translate_title(T._normalize(o))
            miss = ' '.join(T._MISSING)
            print(f'      {o!r:70s} -> {out!r:28s} miss={miss}')
