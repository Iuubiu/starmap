import json, sys, re
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
CONTENT = Path('content')
EN = {'ahmed-2e','debertin-1988','gilmore-2e-2008','grupen-2e-2008','knoll-3e-2000','knoll-4e-2010',
      'leo-2e','lutz-2007','nakhostin-2018','nicholson-1974','rivetti-2015','spieler-2005','tsoulfanidis-4e'}
HINT = set('=+×÷±≥≤≠≈<>∑∏∫√∞∂∆∇→←↔⇒⇔∈∉⊂⊃∪∩')
WORD = re.compile(r'[A-Za-z]{3,}')
def ar(t): return sum(1 for c in t if c.isascii() and c.isalpha())/max(1,len(t))
def feat(t):
    words = WORD.findall(t)
    hints = sum(1 for ch in t if ch in HINT)
    return len(words), len(words)/max(1,len(t)/100), hints, hints/max(1,len(t)/100)
target=[]; others=[]
for d in sorted(CONTENT.iterdir()):
    f=d/'chunks.jsonl'
    if not f.is_file(): continue
    for line in f.read_text(encoding='utf-8').splitlines():
        c=json.loads(line); t=c.get('text') or ''
        if c.get('kind')!='formula': continue
        if len(t)>200 and ar(t)>0.55:
            target.append((d.name, c['id'], len(t), feat(t)))
        else:
            others.append((d.name, c['id'], len(t), feat(t)))
print('== TARGET (35) : words, words/100ch, hints, hints/100ch')
for n,i,L,(w,wr,h,hr) in target:
    print(f'  L={L:5} words={w:4} w/100={wr:6.2f} hints={h:4} h/100={hr:6.2f}  {n}/{i[:40]}')
print()
import statistics as st
ws=[x[3][0] for x in target]; wrs=[x[3][1] for x in target]
print('TARGET words min/max', min(ws), max(ws), ' w/100 min/max', round(min(wrs),2), round(max(wrs),2))
ow=[x[3][0] for x in others]; owr=[x[3][1] for x in others]
print('OTHER formulas n=%d words max=%d  w/100 max=%.2f  p99=%.2f' % (len(others), max(ow), max(owr), sorted(owr)[int(len(owr)*0.99)]))
print('OTHER with words>=10:', sum(1 for x in others if x[3][0]>=10))
for n,i,L,(w,wr,h,hr) in sorted([o for o in others if o[3][0]>=10], key=lambda x:-x[3][0])[:15]:
    print(f'  L={L:5} words={w:4} w/100={wr:6.2f} hints={h:4}  {n}/{i[:40]}')
