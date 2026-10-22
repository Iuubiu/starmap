"""t24 第二件：普查 12 本 toc.json 里 depth=0 且 num 为空的节点（卷名/序言/目录/无编号前言）。"""
import glob, json, os, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

print(f"{'sourceId':46s} {'节点':>5} {'d0':>3} {'d0&num空':>8} {'d0叶':>5} {'d0叶&num空':>10}")
allbad = []
for p in sorted(glob.glob('content/*/toc.json')):
    sid = os.path.basename(os.path.dirname(p))
    nodes = json.load(open(p, encoding='utf-8'))['nodes']
    d0 = [n for n in nodes if n['depth'] == 0]
    d0_empty = [n for n in d0 if not (n.get('num') or '').strip()]
    d0_leaf = [n for n in d0 if n.get('isLeaf')]
    bad = [n for n in d0 if n.get('isLeaf') and not (n.get('num') or '').strip()]
    allbad.extend((sid, n) for n in bad)
    print(f'{sid:46s} {len(nodes):>5} {len(d0):>3} {len(d0_empty):>8} {len(d0_leaf):>5} {len(bad):>10}')

print(f'\n=== 全部 depth=0 && isLeaf && num=="" 的节点（{len(allbad)} 个） ===')
for sid, n in allbad:
    print(f"  {sid:44s} {n['microKpId']:44s} name={n['name']!r:24s} p={n.get('printedPage')} "
          f"parent={n.get('parentId')}")

print('\n=== 全部 depth=0 的节点（含非叶） ===')
for p in sorted(glob.glob('content/*/toc.json')):
    sid = os.path.basename(os.path.dirname(p))
    nodes = json.load(open(p, encoding='utf-8'))['nodes']
    d0 = [n for n in nodes if n['depth'] == 0]
    if d0:
        print(f'-- {sid}')
        for n in d0:
            print(f"   {n['microKpId']:44s} num={(n.get('num') or '')!r:8s} p={n.get('printedPage'):4} "
                  f"leaf={n.get('isLeaf')} name={n['name']!r}")
