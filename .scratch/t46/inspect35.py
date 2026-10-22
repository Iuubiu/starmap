import json, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
CONTENT = Path('content')
def ar(t):
    return sum(1 for c in t if c.isascii() and c.isalpha())/max(1,len(t))
rows=[]
for d in sorted(CONTENT.iterdir()):
    f=d/'chunks.jsonl'
    if not f.is_file(): continue
    for line in f.read_text(encoding='utf-8').splitlines():
        c=json.loads(line)
        t=c.get('text') or ''
        if c.get('kind')=='formula' and len(t)>200 and ar(t)>0.55:
            zh=[ch for ch in t if '\u4e00'<=ch<='\u9fff']
            rows.append((d.name, c['id'], round(ar(t),2), len(zh), bool(c.get('answer_for')), t[:110].replace('\n',' ')))
print('total', len(rows))
from collections import Counter
print(Counter(r[0] for r in rows))
for r in rows[:40]:
    print(f'{r[0]:22s} {r[1]:28s} ar={r[2]} zh={r[3]:3d} ans={r[4]} | {r[5]}')
