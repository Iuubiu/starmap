import json, re, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = Path('content')
EN = ['ahmed-2e','debertin-1988','gilmore-2e-2008','grupen-2e-2008','knoll-3e-2000','knoll-4e-2010',
      'leo-2e','lutz-2007','nakhostin-2018','nicholson-1974','rivetti-2015','spieler-2005','tsoulfanidis-4e']
CJK = re.compile(r'[\u4e00-\u9fff]')
ENP = re.compile(r'[,;:]|\.(?!\d)')
W3 = re.compile(r'[A-Za-z]{3,}')
def ar(t):
    n=len(t); return sum(1 for c in t if c.isascii() and c.isalpha())/n if n else 0
def is_prose_like(t):
    return len(t) > 200 and ar(t) > 0.55
def punct_count(t):
    n = sum(1 for ch in t if ch in '，。、；：')
    if not CJK.search(t): n += len(ENP.findall(t))
    return n
# 候选规则：ASCII 主导 + 长 + 句读密集 → 不是公式
def looks_formula_new(t):
    if CJK.search(t): return None  # 中文不动
    if is_prose_like(t) and punct_count(t) > 4: return False
    return True  # 其余沿用旧判定（旧判定为 True 的才会进来）
res = {}
for sid in EN:
    p = ROOT/sid/'chunks.jsonl'
    if not p.exists(): continue
    f=pl=pl_left=0
    for line in p.read_text(encoding='utf-8').splitlines():
        if not line.strip(): continue
        c=json.loads(line)
        if c['kind']!='formula': continue
        f+=1
        if is_prose_like(c['text']):
            pl+=1
            if not (punct_count(c['text'])>4): pl_left+=1
    res[sid]=(f,pl,pl_left)
print(f'{"sid":22s} {"formula":>7s} {"proseLike":>9s} {"leftAsFormula":>13s}')
tf=tp=tl=0
for sid,(f,pl,left) in res.items():
    print(f'{sid:22s} {f:7d} {pl:9d} {left:13d}'); tf+=f; tp+=pl; tl+=left
print(f'{"TOTAL":22s} {tf:7d} {tp:9d} {tl:13d}')
