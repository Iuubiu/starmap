"""t24 第二件：全部 num 为空的叶节点，按书/父节点分组，看能不能从兄弟编号推断。"""
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
    empt = [n for n in nodes if n.get('isLeaf') and not (n.get('num') or '').strip()]
    if not empt:
        continue
    inferable = 0
    print(f'== {sid}  空 num 叶节点 {len(empt)} 个')
    for n in empt:
        sibs = kids.get(n.get('parentId'), [])
        numbered = [s for s in sibs if (s.get('num') or '').strip()]
        # 前后最近的有编号兄弟
        idx = sibs.index(n)
        prev_n = next((s for s in reversed(sibs[:idx]) if (s.get('num') or '').strip()), None)
        next_n = next((s for s in sibs[idx + 1:] if (s.get('num') or '').strip()), None)
        print(f"   {n['microKpId']:46s} name={n['name']!r:20s} p={n.get('printedPage'):4} "
              f"parent={str(n.get('parentId')):40s} 兄弟{len(sibs):2d}/有号{len(numbered):2d} "
              f"prev={(prev_n or {}).get('num') or '-':8s} next={(next_n or {}).get('num') or '-':8s}")
    print()
