import json, sys
sys.path.insert(0, 'tools/ingest')
from cross_edges import WHITELIST, load_leaves
leaves = load_leaves()
bad = 0
for e in WHITELIST:
    a, b = leaves.get(e.from_id), leaves.get(e.to_id)
    if not a or not b:
        print('MISSING', e.from_id, e.to_id); bad += 1; continue
    for t in e.matched:
        ina, inb = t in a.name, t in b.name
        if not (ina or inb):
            print(f'TERM NOT IN EITHER: {t!r}  {a.name!r} -> {b.name!r}'); bad += 1
        elif not (ina and inb):
            print(f'TERM ONLY ONE SIDE: {t!r} inA={ina} inB={inb}  {a.name!r} -> {b.name!r}')
print('bad', bad, 'total', len(WHITELIST))
