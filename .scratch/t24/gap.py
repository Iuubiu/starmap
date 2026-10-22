"""能不能从「同父下的编号序列缺口 + printedPage 顺序」确定地补回丢失的编号？
只承认唯一解：某个缺号恰好只对应一个无编号叶节点，且它的页码落在相邻两个有号兄弟之间。
"""
import glob, json, os, re, sys
from collections import defaultdict
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

def num_key(num, depth):
    parts = [p for p in (num or '').split('.') if p.strip().isdigit()]
    return tuple(int(p) for p in parts)

for p in sorted(glob.glob('content/*/toc.json')):
    sid = os.path.basename(os.path.dirname(p))
    nodes = json.load(open(p, encoding='utf-8'))['nodes']
    kids = defaultdict(list)
    for n in nodes:
        kids[n.get('parentId')].append(n)
    inf = []
    amb = []
    for pid, sibs in kids.items():
        numbered = [(num_key(s.get('num'), s.get('depth')), s) for s in sibs if (s.get('num') or '').strip()]
        if len(numbered) < 2:
            continue
        empt = [s for s in sibs if s.get('isLeaf') and not (s.get('num') or '').strip()]
        if not empt:
            continue
        # 该父下所有有号兄弟的「最后一个分量」，找缺口
        base = num_key(numbered[0][1].get('num'), numbered[0][1].get('depth'))
        prefix = base[:-1]
        have = {num_key(s.get('num'), s.get('depth'))[-1] for _, s in numbered}
        if not prefix:
            continue
        lo, hi = min(have), max(have)
        gaps = [k for k in range(lo, hi + 1) if k not in have]
        if not gaps:
            continue
        # 按页序插入空号节点
        ordered = sorted(sibs, key=lambda s: (s.get('printedPage'), s['microKpId']))
        for e in empt:
            idx = ordered.index(e)
            prev_n = next((s for s in reversed(ordered[:idx]) if (s.get('num') or '').strip()), None)
            next_n = next((s for s in ordered[idx+1:] if (s.get('num') or '').strip()), None)
            if prev_n is None or next_n is None:
                amb.append((pid, e, '端部无锚点')); continue
            lo_k = num_key(prev_n['num'], prev_n['depth'])[-1]
            hi_k = num_key(next_n['num'], next_n['depth'])[-1]
            cand = [g for g in gaps if lo_k < g < hi_k]
            if len(cand) == 1:
                inf.append((pid, e, f"{'.'.join(map(str,prefix))}.{cand[0]}"))
            else:
                amb.append((pid, e, f'候选 {cand}（prev={prev_n["num"]} next={next_n["num"]}）'))
    if inf or amb:
        print(f'== {sid}')
        for pid, e, n in inf:
            print(f'   可推断 {e["microKpId"]:44s} p={e.get("printedPage"):4} {e["name"]!r} → {n}')
        for pid, e, why in amb:
            print(f'   不可推断 {e["microKpId"]:44s} p={e.get("printedPage"):4} {e["name"]!r}  {why}')
        print()
