import json, re, sys, random
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = Path('content')
EN = ['ahmed-2e','debertin-1988','gilmore-2e-2008','grupen-2e-2008','knoll-3e-2000','knoll-4e-2010',
      'leo-2e','lutz-2007','nakhostin-2018','nicholson-1974','rivetti-2015','spieler-2005','tsoulfanidis-4e']
HINT = set('=∑∫√±×÷∞≈≤≥≠∂Δ')
def ar(t):
    n=len(t); return sum(1 for c in t if c.isascii() and c.isalpha())/n if n else 0
def prose_like(t): return len(t)>200 and ar(t)>0.55
rows=[]
for sid in EN:
    p=ROOT/sid/'chunks.jsonl'
    if not p.exists(): continue
    for line in p.read_text(encoding='utf-8').splitlines():
        if not line.strip(): continue
        c=json.loads(line)
        if c['kind']=='formula': rows.append((sid,c['id'],c['text']))
pl=[r for r in rows if prose_like(r[2])]
# 真公式的候选：含 hint 且长度短；看看 prose-like 里有多少含 hint 且"看起来像公式"
short=[r for r in rows if not prose_like(r[2])]
print('prose-like', len(pl), ' rest', len(short))
print('rest len stats: min', min(len(r[2]) for r in short), 'max', max(len(r[2]) for r in short))
print('rest 中 len>200 的:', sum(1 for r in short if len(r[2])>200))
# 看 prose-like 里有没有"真公式"嫌疑：hint 字符数 >=3 且 行内无连续英文单词>4
def formula_score(t):
    h=sum(1 for c in t if c in HINT)
    return h
pl_sorted=sorted(pl, key=lambda r:-formula_score(r[2]))
print('\n--- prose-like 里 hint 字符最多的 8 条 ---')
for sid,i,t in pl_sorted[:8]:
    print(f'{sid} {i} len={len(t)} hint={formula_score(t)} :: {t[:150]!r}')
print('\n--- rest 里最长的 5 条（真公式应在这里）---')
for sid,i,t in sorted(short, key=lambda r:-len(r[2]))[:5]:
    print(f'{sid} {i} len={len(t)} hint={formula_score(t)} :: {t[:150]!r}')
