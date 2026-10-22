import json, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
CONTENT = Path('content')
def ar(t): return sum(1 for c in t if c.isascii() and c.isalpha())/max(1,len(t))
def han(t): return sum(1 for ch in t if '\u4e00'<=ch<='\u9fff')
long_real=[]; allreal=[]
for d in sorted(CONTENT.iterdir()):
    f=d/'chunks.jsonl'
    if not f.is_file(): continue
    for line in f.read_text(encoding='utf-8').splitlines():
        c=json.loads(line); t=c.get('text') or ''
        if c.get('kind')!='formula': continue
        a=ar(t)
        if len(t)>200: long_real.append((a,len(t),han(t),d.name,c['id']))
        allreal.append(a)
long_real.sort(reverse=True)
print('formula chunks with len>200: %d' % len(long_real))
print('top-10 ar among them:')
for a,L,h,n,i in long_real[:10]:
    print('   ar=%.2f L=%4d han=%3d %s/%s' % (a,L,h,n,i[-12:]))
print()
print('count ar>0.55 among len>200: %d' % sum(1 for r in long_real if r[0]>0.55))
print('count ar>0.55 among len>200 and han>0: %d' % sum(1 for r in long_real if r[0]>0.55 and r[2]>0))
print('count ar>0.55 among len>200 and han==0: %d' % sum(1 for r in long_real if r[0]>0.55 and r[2]==0))
print()
print('ar distribution of all formula chunks: max %.2f  count>0.55 (any length) %d' % (max(allreal), sum(1 for a in allreal if a>0.55)))
