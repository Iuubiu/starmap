import json, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
CONTENT = Path('content')
EN = {'ahmed-2e','debertin-1988','gilmore-2e-2008','grupen-2e-2008','knoll-3e-2000','knoll-4e-2010',
      'leo-2e','lutz-2007','nakhostin-2018','nicholson-1974','rivetti-2015','spieler-2005','tsoulfanidis-4e'}
def ar(t): return sum(1 for c in t if c.isascii() and c.isalpha())/max(1,len(t))
flip=[]; keep=[]
for d in sorted(CONTENT.iterdir()):
    f=d/'chunks.jsonl'
    if not f.is_file(): continue
    for line in f.read_text(encoding='utf-8').splitlines():
        c=json.loads(line); t=c.get('text') or ''
        if c.get('kind')!='formula': continue
        if len(t)>200 and ar(t)>0.55:
            flip.append((d.name in EN, d.name, c['id'], len(t), round(ar(t),2), t[:90].replace('\n',' ')))
print('would flip formula->text: %d' % len(flip))
print('  from EN books: %d ; from ZH books: %d' % (sum(1 for f in flip if f[0]), sum(1 for f in flip if not f[0])))
print()
print('--- from ZH books (must explain each) ---')
for f in flip:
    if not f[0]: print('  %s %s L=%d ar=%.2f | %s' % (f[1], f[2][-12:], f[3], f[4], f[5]))
