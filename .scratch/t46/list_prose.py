import json, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
CONTENT = Path('content')
EN = {'ahmed-2e','debertin-1988','gilmore-2e-2008','grupen-2e-2008','knoll-3e-2000','knoll-4e-2010',
      'leo-2e','lutz-2007','nakhostin-2018','nicholson-1974','rivetti-2015','spieler-2005','tsoulfanidis-4e'}
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
            rows.append((d.name, c['id'], c.get('page'), bool(c.get('answer_for')), round(ar(t),2),
                         sum(1 for ch in t if ch in ',;:!'), sum(1 for ch in t if ch in '，。、；：'),
                         sum(1 for ch in t if '\u4e00'<=ch<='\u9fff'), t[:90].replace('\n',' ')))
print('total', len(rows))
for r in rows:
    print(f'{r[0]:22s} {r[1]:34s} p{r[2]!s:>5} ans={r[3]!s:5} ar={r[4]:4} asciiP={r[5]:3} cjkP={r[6]:3} han={r[7]:4} | {r[8]}')
