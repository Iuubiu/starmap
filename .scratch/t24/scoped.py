"""圈定「同父同名叶节点、且该父下有编号兄弟」的违规组（= 能推断却没推断出的）。"""
import glob, json, os, sys
from collections import defaultdict
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
tot = 0
for p in sorted(glob.glob('content/*/toc.json')):
    sid = os.path.basename(os.path.dirname(p))
    nodes = json.load(open(p, encoding='utf-8'))['nodes']
    kids = defaultdict(list)
    for n in nodes:
        kids[n.get('parentId')].append(n)
    out = []
    for pid, sibs in kids.items():
        numbered = [s for s in sibs if (s.get('num') or '').strip()]
        if not numbered:
            continue                      # 该父下完全不用编号：体例如此，不判违规
        grp = defaultdict(list)
        for s in sibs:
            if s.get('isLeaf'):
                grp[s['name']].append(s)
        for name, ns in grp.items():
            if len(ns) < 2:
                continue
            nums = [(n.get('num') or '').strip() for n in ns]
            if any(not x for x in nums) or len(set(nums)) != len(nums):
                out.append((pid, name, ns, len(numbered), len(sibs)))
    if out:
        print(f'== {sid}')
        for pid, name, ns, nn, nsib in out:
            print(f'   父 {pid}  {name!r} ×{len(ns)}  （父下有编号 {nn}/{nsib}）')
            for n in ns:
                print(f"      {n['microKpId']:44s} num={(n.get('num') or '')!r:8s} p={n.get('printedPage')}")
            tot += 1
print('\n违规组合计', tot)
