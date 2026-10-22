import json, re, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = Path('content')
CJK = re.compile(r'[\u4e00-\u9fff]')
def ar(t):
    n=len(t); return sum(1 for c in t if c.isascii() and c.isalpha())/n if n else 0
def prose_like(t): return len(t)>200 and ar(t)>0.55

# 新守卫：非中文 + len>200 + ascii_alpha>0.55 => 不是公式
def looks_formula_new(t):
    if len(t)>200 and ar(t)>0.55 and not CJK.search(t):
        return False
    return True   # 其它情况沿用旧判据

allf=[]; killed=[]; kept=[]
for p in sorted(ROOT.glob('*/chunks.jsonl')):
    sid=p.parent.name
    for line in p.read_text(encoding='utf-8').splitlines():
        if not line.strip(): continue
        c=json.loads(line)
        if c['kind']!='formula': continue
        allf.append((sid,c['id'],c['text']))
        if prose_like(c['text']):
            (killed if not looks_formula_new(c['text']) else kept).append((sid,c['id'],c['text']))
print('total formula', len(allf))
print('prose-like', len(killed)+len(kept), 'killed', len(killed), 'kept', len(kept))
# 会误杀的真公式？看 killed 里 hint 密度高且短句的
import statistics
def hint(t): return sum(1 for ch in t if ch in set('=∑∫√±×÷∞≈≤≥≠∂Δ'))
print('killed hint median', statistics.median([hint(t) for _,_,t in killed]))
print('killed len median', statistics.median([len(t) for _,_,t in killed]))
print('\n--- kept(仍判公式) 的前 5 条 ---')
for sid,i,t in kept[:5]:
    print(f'{sid} {i} len={len(t)} :: {t[:120]!r}')
