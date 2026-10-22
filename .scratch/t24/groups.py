"""列出所有违反「同名同 depth 叶节点 num 必须非空且互不相同」的组，含父与兄弟上下文。"""
import glob, json, os, sys
from collections import defaultdict
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

for p in sorted(glob.glob('content/*/toc.json')):
    sid = os.path.basename(os.path.dirname(p))
    nodes = json.load(open(p, encoding='utf-8'))['nodes']
    byid = {n['microKpId']: n for n in nodes}
    kids = defaultdict(list)
    for n in nodes:
        kids[n.get('parentId')].append(n)
    groups = defaultdict(list)
    for n in nodes:
        if n.get('isLeaf'):
            groups[(n['depth'], n['name'])].append(n)
    bad = []
    for (depth, name), ns in groups.items():
        if len(ns) < 2:
            continue
        nums = [(n.get('num') or '').strip() for n in ns]
        if any(not x for x in nums) or len(set(nums)) != len(nums):
            bad.append((depth, name, ns))
    if not bad:
        continue
    print(f'== {sid}  违反组 {len(bad)}')
    for depth, name, ns in bad:
        parents = {n.get('parentId') for n in ns}
        print(f'   d{depth} {name!r} ×{len(ns)}  父={[byid.get(x, {}).get("name") for x in parents]}  父num={[byid.get(x, {}).get("num") for x in parents]}')
        for n in ns:
            sibs = kids.get(n.get('parentId'), [])
            idx = sibs.index(n) if n in sibs else -1
            prev_n = next((s for s in reversed(sibs[:idx]) if (s.get('num') or '').strip()), None) if idx > 0 else None
            next_n = next((s for s in sibs[idx+1:] if (s.get('num') or '').strip()), None) if idx >= 0 else None
            print(f"       {n['microKpId']:44s} num={(n.get('num') or '')!r:8s} p={n.get('printedPage'):4} "
                  f"prev={(prev_n or {}).get('num') or '-':8s} next={(next_n or {}).get('num') or '-':8s}")
    print()
