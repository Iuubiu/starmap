"""t24 第二件：找同书内「同名且同 depth」的叶节点，其中 num 为空的（= OCR 丢了编号）。"""
import glob, json, os, sys
from collections import defaultdict
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

total_groups = 0
total_nodes = 0
report = []
for p in sorted(glob.glob('content/*/toc.json')):
    sid = os.path.basename(os.path.dirname(p))
    nodes = json.load(open(p, encoding='utf-8'))['nodes']
    groups = defaultdict(list)
    for n in nodes:
        if n.get('isLeaf'):
            groups[(n['depth'], n['name'])].append(n)
    dups = {k: v for k, v in groups.items() if len(v) > 1}
    if not dups:
        continue
    print(f'== {sid}  同名同 depth 叶节点 {len(dups)} 组 / {sum(len(v) for v in dups.values())} 个')
    for (depth, name), ns in sorted(dups.items()):
        nums = [n.get('num') or '' for n in ns]
        empt = [n for n in ns if not (n.get('num') or '').strip()]
        flag = '  ← 有 num 空的' if empt else ''
        print(f'   d{depth} {name!r:22s} n={len(ns):2d} 空num={len(empt)}{flag}')
        for n in ns:
            print(f"       {n['microKpId']:46s} num={(n.get('num') or '')!r:10s} p={n.get('printedPage')}")
        total_groups += 1
        total_nodes += len(ns)
        report.append(dict(sourceId=sid, depth=depth, name=name, count=len(ns),
                           emptyNum=len(empt), nodes=ns))
print(f'\n合计 {total_groups} 组 / {total_nodes} 个同名同 depth 叶节点')
json.dump(report, open('.scratch/t24/dups.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
