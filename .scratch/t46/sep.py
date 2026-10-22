import json, sys, re
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
CONTENT = Path('content')
EN = {'ahmed-2e','debertin-1988','gilmore-2e-2008','grupen-2e-2008','knoll-3e-2000','knoll-4e-2010',
      'leo-2e','lutz-2007','nakhostin-2018','nicholson-1974','rivetti-2015','spieler-2005','tsoulfanidis-4e'}
def ar(t): return sum(1 for c in t if c.isascii() and c.isalpha())/max(1,len(t))
def sp(t): return sum(1 for c in t if c==' ')/max(1,len(t))
def code(t): return sum(1 for c in t if c in ';(){}[]')/max(1,len(t))
rows=[]
for d in sorted(CONTENT.iterdir()):
    f=d/'chunks.jsonl'
    if not f.is_file(): continue
    for line in f.read_text(encoding='utf-8').splitlines():
        c=json.loads(line); t=c.get('text') or ''
        if c.get('kind')=='formula' and len(t)>200 and ar(t)>0.55:
            rows.append((d.name in EN, d.name, c['id'], round(ar(t),2), round(sp(t),3), round(code(t),3), sum(1 for ch in t if '\u4e00'<=ch<='\u9fff')))
en=[r for r in rows if r[0]]; zh=[r for r in rows if not r[0]]
print('EN n=%d' % len(en))
for r in en: print(f'  ar={r[3]:4} sp={r[4]:5} code={r[5]:5} han={r[6]:4} {r[2]}')
print('ZH n=%d' % len(zh))
for r in zh: print(f'  ar={r[3]:4} sp={r[4]:5} code={r[5]:5} han={r[6]:4} {r[2]}')
print()
print('EN  sp min/max', min(r[4] for r in en), max(r[4] for r in en))
print('ZH  sp min/max', min(r[4] for r in zh), max(r[4] for r in zh))
print('EN  code min/max', min(r[5] for r in en), max(r[5] for r in en))
print('ZH  code min/max', min(r[5] for r in zh), max(r[5] for r in zh))
