import io, json, re, sys, collections
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
CONTENT = Path('content')
TOC = sorted(CONTENT.glob('*/toc.json'))
rx = re.compile(r'^\s*(\d+(?:\.\d+)+)\s+')
tot = 0
native = 0
trans = 0
per = collections.Counter()
samples = []
for p in TOC:
    d = json.load(io.open(p, encoding='utf-8'))
    sid = d.get('sourceId') or p.parent.name
    for n in d.get('nodes', []):
        nm = n.get('name') or ''
        m = rx.match(nm)
        if not m:
            continue
        if (n.get('num') or '') != m.group(1):
            continue
        tot += 1
        if (n.get('nameOriginal') or ''):
            trans += 1
            per[sid] += 1
            if len(samples) < 15:
                samples.append((sid, n.get('microKpId'), nm, n.get('num'), n.get('nameOriginal')))
        else:
            native += 1
print('total', tot, 'translated(缺陷B)', trans, 'native', native)
print(dict(per))
for s in samples: print(' ', s)
