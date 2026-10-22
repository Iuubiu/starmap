import io, json, sys, collections
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(Path('tools/ingest').resolve()))
import translate as T

CONTENT = Path('content')
groups_before = 0
groups_after = 0
detail = []
for p in sorted(CONTENT.glob('*/toc.json')):
    d = json.load(io.open(p, encoding='utf-8'))
    sid = d.get('sourceId') or p.parent.name
    byname = collections.defaultdict(list)
    for n in d.get('nodes', []):
        byname[n.get('name') or ''].append(n)
    for name, ns in byname.items():
        origs = sorted({(n.get('nameOriginal') or '') for n in ns})
        origs = [o for o in origs if o]
        if len(origs) < 2:
            continue
        groups_before += 1
        # re-translate each original with the NEW glossary
        new = []
        for o in origs:
            new.append(T.translate_title(o))
        if len(set(new)) < len(set(origs)):
            groups_after += 1
            detail.append((sid, name, list(zip(origs, new))))

print('groups_before', groups_before, 'still_collapsed', groups_after)
with io.open('.scratch/t45/still_collapsed.txt', 'w', encoding='utf-8') as f:
    for sid, name, pairs in detail:
        f.write(f'{sid} | {name}\n')
        for o, n in pairs:
            f.write(f'    {o!r} -> {n!r}\n')
