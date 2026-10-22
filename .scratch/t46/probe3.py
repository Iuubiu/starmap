import json, re, sys, statistics
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = Path('content')
EN = ['ahmed-2e','debertin-1988','gilmore-2e-2008','grupen-2e-2008','knoll-3e-2000','knoll-4e-2010',
      'leo-2e','lutz-2007','nakhostin-2018','nicholson-1974','rivetti-2015','spieler-2005','tsoulfanidis-4e']
WORD3 = re.compile(r'[A-Za-z]{3,}')
DIGIT = re.compile(r'\d')
def stats(t):
    n = len(t)
    letters = sum(1 for c in t if c.isascii() and c.isalpha())
    w3 = WORD3.findall(t)
    # 句末标点后跟空白+大写 = 句子边界
    sent = len(re.findall(r'[.!?]\s+[A-Z]', t))
    # 半角标点（排除小数点：数字.数字 不算）
    punct = len(re.findall(r'(?<!\d)[,;:](?!\d)|\.(?!\d)', t))
    return dict(n=n, ar=letters/n if n else 0, w3=len(w3), w3r=len(w3)/n if n else 0,
                sent=sent, punct=punct, pr=punct/n if n else 0)

rows = []
for sid in EN:
    p = ROOT/sid/'chunks.jsonl'
    if not p.exists(): continue
    for line in p.read_text(encoding='utf-8').splitlines():
        if not line.strip(): continue
        c = json.loads(line)
        if c['kind'] != 'formula': continue
        rows.append((sid, c['id'], c['text']))
print('formula chunks:', len(rows))
prose = [(sid,i,t,stats(t)) for sid,i,t in rows if len(t) > 200 and stats(t)['ar'] > 0.55]
rest  = [(sid,i,t,stats(t)) for sid,i,t in rows if not (len(t) > 200 and stats(t)['ar'] > 0.55)]
print('prose-like:', len(prose), ' rest:', len(rest))
for name, key in [('w3', 'w3'), ('w3r','w3r'), ('sent','sent'), ('punct','punct'), ('pr','pr')]:
    pv = sorted(s[key] for _,_,_,s in prose); rv = sorted(s[key] for _,_,_,s in rest)
    def q(v, x): return v[min(len(v)-1, int(len(v)*x))] if v else 0
    print(f'{key:6s} prose p5={q(pv,.05):8.3f} p50={q(pv,.5):8.3f} p95={q(pv,.95):8.3f} | rest p5={q(rv,.05):8.3f} p50={q(rv,.5):8.3f} p95={q(rv,.95):8.3f}')
