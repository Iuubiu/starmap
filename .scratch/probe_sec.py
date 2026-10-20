import io
import json

toc = json.load(io.open('content/digital-kanghua-5e/toc.json', encoding='utf-8'))['nodes']
by_depth = {}
for n in toc:
    by_depth.setdefault(n['depth'], []).append(n)
print({d: len(v) for d, v in sorted(by_depth.items())})
print('leaves', sum(1 for n in toc if n['isLeaf']))

# 章（depth 1）与其下的节（depth 2）
chapters = [n for n in toc if n['depth'] == 1]
print('chapters', len(chapters))
for c in chapters:
    secs = [n for n in toc if n['depth'] == 2 and n['parentId'] == c['microKpId']]
    leaves = [n for n in toc if n['isLeaf'] and n['microKpId'].startswith(c['microKpId'].replace('kp-', 'kp-'))]
    print(f"  {c['num']:>3} {c['name']}  p.{c['printedPage']}  节={len(secs)}")

# 每个节下的叶子
sec_leaf = {}
for n in toc:
    if n['depth'] == 2:
        kids = [m for m in toc if m['isLeaf'] and m['parentId'] == n['microKpId']]
        sec_leaf[n['microKpId']] = [k['microKpId'] for k in kids]
print('节下直接挂叶子的数量分布', sorted({len(v) for v in sec_leaf.values()}))
no_leaf = [k for k, v in sec_leaf.items() if not v]
print('没有叶子的节', len(no_leaf), no_leaf[:5])
