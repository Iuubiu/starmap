import io, json, sys, collections
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(Path('tools/ingest').resolve()))
import translate as T

CONTENT = Path('content')
def load(p): return json.load(io.open(p, encoding='utf-8'))

fixed_by_retranslate = []
still = []
for p in sorted(CONTENT.glob('*/toc.json')):
    d = load(p); sid = d.get('sourceId') or p.parent.name
    byname = collections.defaultdict(list)
    for n in d.get('nodes', []):
        byname[n.get('name') or ''].append(n)
    for name, ns in byname.items():
        origs = sorted({ (n.get('nameOriginal') or '') for n in ns })
        if len(origs) < 2: continue
        outs = [T.translate_title(T._normalize(o)) for o in origs if o]
        if len(set(outs)) == len(outs):
            fixed_by_retranslate.append((sid, name, origs, outs))
        else:
            still.append((sid, name, origs, outs))

print('=== would be FIXED by re-translating with current GLOSSARY:', len(fixed_by_retranslate))
for s in fixed_by_retranslate:
    print(f'  {s[0]:22s} [{s[1]}] -> {s[3]}')
print()
print('=== STILL collapsed after re-translate:', len(still))
for s in still:
    print(f'  {s[0]:22s} [{s[1]}]')
    for o,u in zip(s[2], s[3]): print(f'        {o!r:55s} -> {u!r}')
