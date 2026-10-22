import json, re, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
CONTENT = Path('content')
def ar(t): return sum(1 for c in t if c.isascii() and c.isalpha())/max(1,len(t))
def has_zh(t): return any('\u4e00'<=ch<='\u9fff' for ch in t)
def space_ratio(t): return sum(1 for c in t if c==' ')/max(1,len(t))
def mean_tok(t):
    toks=[w for w in re.split(r'\s+',t) if w]
    return sum(len(w) for w in toks)/max(1,len(toks))
def long_word_ratio(t):
    toks=[w for w in re.split(r'\s+',t) if w]
    return sum(1 for w in toks if len(w)>=4)/max(1,len(toks))
groups={}
for d in sorted(CONTENT.iterdir()):
    f=d/'chunks.jsonl'
    if not f.is_file(): continue
    for line in f.read_text(encoding='utf-8').splitlines():
        c=json.loads(line); t=c.get('text') or ''
        if c.get('kind')=='formula' and len(t)>200 and ar(t)>0.55:
            k = 'ZH-code' if has_zh(t) else 'EN-prose'
            groups.setdefault(k,[]).append((d.name,t))
for k,v in groups.items():
    print(f'== {k}: {len(v)} ==')
    for name,t in v[:6]:
        print(f'  {name:22s} ar={ar(t):.2f} sp={space_ratio(t):.3f} mTok={mean_tok(t):.1f} lw={long_word_ratio(t):.2f} | {t[:70]!r}')
    print(f'  mean sp={sum(space_ratio(t) for _,t in v)/len(v):.3f} mean mTok={sum(mean_tok(t) for _,t in v)/len(v):.1f} mean lw={sum(long_word_ratio(t) for _,t in v)/len(v):.2f}')
# control: real formula blocks
ctrl=[]
for d in sorted(CONTENT.iterdir()):
    f=d/'chunks.jsonl'
    if not f.is_file(): continue
    for line in f.read_text(encoding='utf-8').splitlines():
        c=json.loads(line); t=c.get('text') or ''
        if c.get('kind')=='formula' and len(t)>200 and ar(t)<=0.55:
            ctrl.append((d.name,t))
print(f'== control formula (ar<=0.55): {len(ctrl)} ==')
for name,t in ctrl[:5]:
    print(f'  {name:22s} ar={ar(t):.2f} sp={space_ratio(t):.3f} mTok={mean_tok(t):.1f} | {t[:60]!r}')
