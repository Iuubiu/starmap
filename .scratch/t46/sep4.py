import json, sys, re
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
CONTENT = Path('content')
TOK = re.compile(r'[A-Za-z][A-Za-z\'\-]*')
def ar(t): return sum(1 for c in t if c.isascii() and c.isalpha())/max(1,len(t))
def han(t): return sum(1 for ch in t if '\u4e00'<=ch<='\u9fff')
def longest_run(t):
    """最长「连续 ASCII 单词」长度（单词之间只允许空白/逗号/句点）"""
    best=cur=0
    for m in re.finditer(r"[A-Za-z][A-Za-z'\-]*(?:(?:[ ,.;:]+)(?=[A-Za-z]))*", t):
        n=len(TOK.findall(m.group(0)))
        best=max(best,n)
    return best
tgt=[]; real=[]
for d in sorted(CONTENT.iterdir()):
    f=d/'chunks.jsonl'
    if not f.is_file(): continue
    for line in f.read_text(encoding='utf-8').splitlines():
        c=json.loads(line); t=c.get('text') or ''
        if c.get('kind')!='formula': continue
        rec=(d.name,c['id'],len(t),round(ar(t),2),han(t),longest_run(t))
        if len(t)>200 and ar(t)>0.55: tgt.append(rec)
        else: real.append(rec)
print('TARGET longest_run sorted:', sorted(r[5] for r in tgt))
print()
rl=sorted(r[5] for r in real)
print('REAL n=%d longest_run p50=%d p90=%d p99=%d max=%d' % (len(rl), rl[len(rl)//2], rl[int(len(rl)*.9)], rl[int(len(rl)*.99)], rl[-1]))
for thr in (6,7,8,9,10,12):
    hit_t=sum(1 for r in tgt if r[5]>=thr)
    hit_r=sum(1 for r in real if r[5]>=thr)
    print('  thr>=%2d : targets %d/%d   real-formulas %d/%d' % (thr,hit_t,len(tgt),hit_r,len(real)))
print()
print('real formulas with run>=8 (would be flipped to text):')
for r in sorted([x for x in real if x[5]>=8], key=lambda x:-x[5])[:20]:
    print('   run=%2d L=%4d ar=%.2f han=%3d %s/%s' % (r[5],r[2],r[3],r[4],r[0],r[1][-12:]))
