"""看指定节点的兄弟上下文，判断编号能否推断。"""
import json, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
path, *ids = sys.argv[1:]
nodes = json.load(open(path, encoding='utf-8'))['nodes']
byid = {n['microKpId']: n for n in nodes}
kids = {}
for n in nodes:
    kids.setdefault(n.get('parentId'), []).append(n)
for kp in ids:
    n = byid.get(kp)
    if not n:
        print(f'{kp}: 不存在'); continue
    sibs = kids.get(n.get('parentId'), [])
    print(f"== {kp}  name={n['name']!r} d={n['depth']} p={n['printedPage']} parent={n.get('parentId')}")
    print(f"   父: {byid.get(n.get('parentId'), {}).get('name')!r} num={byid.get(n.get('parentId'), {}).get('num')!r}")
    for s in sibs:
        mark = ' <<<' if s['microKpId'] == kp else ''
        print(f"     d{s['depth']} num={(s.get('num') or '')!r:10s} p={s.get('printedPage'):4} leaf={s.get('isLeaf')} {s['name']!r}{mark}")
    print()
