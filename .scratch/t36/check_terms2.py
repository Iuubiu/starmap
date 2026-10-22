import sys
sys.path.insert(0, 'tools/ingest')
from cross_edges import WHITELIST, load_leaves
leaves = load_leaves()
bad = 0
for e in WHITELIST:
    a, b = leaves[e.from_id].name, leaves[e.to_id].name
    for t in e.common_terms:
        if not (t in a and t in b):
            print(f'COMMON TERM MISSING: {t!r} inA={t in a} inB={t in b}  {a!r} -> {b!r}')
            bad += 1
    for x, y in e.synonym_pairs:
        if not ((x in a and y in b) or (y in a and x in b)):
            print(f'SYNONYM PAIR NOT MATCHED: {x!r}/{y!r}  {a!r} -> {b!r}')
            bad += 1
print('bad', bad, 'total', len(WHITELIST))
