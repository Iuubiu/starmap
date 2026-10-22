import json, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
def ar(t): return sum(1 for c in t if c.isascii() and c.isalpha())/max(1,len(t))
def cjk(t): return sum(1 for ch in t if '\u4e00'<=ch<='\u9fff')
rows=[]
for d in sorted(Path('content').iterdir()):
    f=d/'chunks.jsonl'
    if not f.is_file(): continue
    for line in f.read_text(encoding='utf-8').splitlines():
        c=json.loads(line); t=c.get('text') or ''
        if c.get('kind')=='formula' and len(t)>200 and ar(t)>0.55:
            rows.append((d.name, c['id'], round(ar(t),2), cjk(t), bool(c.get('answer_for')), t[:60].replace('\n',' ')))
print('total', len(rows))
from collections import Counter
print('by book:', Counter(r[0] for r in rows))
print('with CJK:', sum(1 for r in rows if r[3]>0), ' without CJK:', sum(1 for r in rows if r[3]==0))
for r in rows: print(f'{r[0]:22s} {r[1]:30s} ar={r[2]} cjk={r[3]:3d} ans={r[4]} | {r[5]!r}')
