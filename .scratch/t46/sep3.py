import json, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
CONTENT = Path('content')
HINT = set('=+×÷±≥≤≠≈<>∑∏∫√∞∂∆∇→←↔⇒⇔∈∉⊂⊃∪∩')
def ar(t): return sum(1 for c in t if c.isascii() and c.isalpha())/max(1,len(t))
def han(t): return sum(1 for ch in t if '\u4e00'<=ch<='\u9fff')
tgt=[]; real=[]
for d in sorted(CONTENT.iterdir()):
    f=d/'chunks.jsonl'
    if not f.is_file(): continue
    for line in f.read_text(encoding='utf-8').splitlines():
        c=json.loads(line); t=c.get('text') or ''
        if c.get('kind')!='formula': continue
        hd = sum(1 for ch in t if ch in HINT)/max(1,len(t)/100)
        rec=(d.name,c['id'],len(t),round(ar(t),2),han(t),round(hd,2))
        if len(t)>200 and ar(t)>0.55: tgt.append(rec)
        else: real.append(rec)
print('real formulas n=',len(real))
hd=[r[5] for r in real]
hd.sort()
print('real h/100: min %.2f p1 %.2f p5 %.2f p50 %.2f p95 %.2f max %.2f' % (hd[0],hd[int(len(hd)*.01)],hd[int(len(hd)*.05)],hd[len(hd)//2],hd[int(len(hd)*.95)],hd[-1]))
print('real with h/100 < 0.5:', sum(1 for x in hd if x<0.5), ' <1.0:', sum(1 for x in hd if x<1.0))
print()
print('targets h/100 sorted:', sorted(r[5] for r in tgt))
print()
# how many real formulas have len>200?
print('real formulas with len>200:', sum(1 for r in real if r[2]>200), '/', len(real))
print('targets with h/100 >= 1.0:', sum(1 for r in tgt if r[5]>=1.0))
for r in sorted([t for t in tgt if t[5]>=1.0], key=lambda x:-x[5]):
    print('  ',r)
