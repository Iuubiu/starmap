"""只找「同一个父节点下、同名且 num 为空的叶节点」—— 这才是真正无法区分的丢编号。"""
import glob, json, os, sys
from collections import defaultdict
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

total = 0
for p in sorted(glob.glob('content/*/toc.json')):
    sid = os.path.basename(os.path.dirname(p))
    nodes = json.load(open(p, encoding='utf-8'))['nodes']
    byid = {n['microKpId']: n for n in nodes}
    kids = defaultdict(list)
    for n in nodes:
        kids[n.get('parentId')].append(n)
    found = []
    for pid, sibs in kids.items():
        grp = defaultdict(list)
        for n in sibs:
            if n.get('isLeaf'):
                grp[n['name']].append(n)
        for name, ns in grp.items():
            if len(ns) > 1:
                found.append((pid, name, ns))
    if not found:
        continue
    print(f'== {sid}  同父同名叶节点 {len(found)} 组')
    for pid, name, ns in found:
        parent = byid.get(pid, {})
        print(f'   父 {pid} {parent.get("name")!r} num={parent.get("num")!r}  组 {name!r} ×{len(ns)}')
        for n in ns:
            print(f"       {n['microKpId']:44s} num={(n.get('num') or '')!r:8s} p={n.get('printedPage')}")
        total += len(ns)
    print()
print('同父同名叶节点合计', total)
