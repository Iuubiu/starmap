import io, json, sys, collections
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(Path('tools/ingest').resolve()))
import translate as T

CONTENT = Path('content')
out = []
for p in sorted(CONTENT.glob('*/toc.json')):
    d = json.load(io.open(p, encoding='utf-8'))
    sid = d.get('sourceId') or p.parent.name
    byname = collections.defaultdict(list)
    for n in d.get('nodes', []):
        byname[n.get('name') or ''].append(n)
    for name, ns in byname.items():
        origs = sorted({(n.get('nameOriginal') or '') for n in ns})
        if len(origs) < 2: continue
        out.append((sid, name, [o for o in origs if o]))

# collect missing tokens across these groups
missing = collections.Counter()
for sid, name, origs in out:
    for o in origs:
        t = T._normalize(o)
        t = T._TRAIL_PUNCT.sub('', T._LEAD_PUNCT.sub('', t))
        t = T._TRAIL_PUNCT.sub('', T._LEAD_PUNCT.sub('', T._strip_number(t)))
        words = T._WORD.findall(t)
        for w in words:
            low = w.lower()
            if not w[0].isalpha(): continue
            if low in T.GLOSSARY or T._stem(low) in T.GLOSSARY: continue
            if low in T.DROP_TOKENS or T._stem(low) in T.DROP_TOKENS: continue
            if low in T.KEEP_TOKENS or T._stem(low) in T.KEEP_TOKENS: continue
            missing[T._stem(low)] += 1

with io.open('.scratch/t45/missing_groups.txt','w',encoding='utf-8') as f:
    f.write(f'groups {len(out)}  distinct missing {len(missing)}\n')
    for w, c in sorted(missing.items(), key=lambda kv: (-kv[1], kv[0])):
        f.write(f'{c:3d}  {w}\n')
print('groups', len(out), 'distinct missing', len(missing))
