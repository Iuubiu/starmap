"""复核 A/B 类碎片在 toc.json 里的上下文（含 num 与相邻兄弟）。

只读，不改任何文件。
"""
import io
import json
import os
import re

CONTENT = 'content'
LEAD = re.compile(r'^[、，。；：）)]')

TARGETS = {
    'analog-electronics-tongshibai-5e': ['、晶体三极管模型及其参数'],
    'nuclear-physics-experiment-methods-1997': [
        '、带电粒子在靶物质中的慢化', '、重带电粒子在物质中的能量损失',
        '、重离子的电子阻止本领', '、倍增过程统计学', '、中子全截面测量', '、概述',
    ],
    'nuclear-radiation-physics-chenboxian-2011': ['。中子探测方法和常用探测器'],
    'radiation-detector-handbook-jichangsong-1990': ['，光导纤维光导', '：工作原理'],
    'radiation-detectors-dinghonglin-2010': ['作用与地位'],
}

out = []
for sid, names in TARGETS.items():
    path = os.path.join(CONTENT, sid, 'toc.json')
    doc = json.load(io.open(path, encoding='utf-8'))
    nodes = doc['nodes']
    by_id = {n['microKpId']: n for n in nodes}
    out.append(f'########## {sid}  nodes={len(nodes)}')
    for target in names:
        hits = [i for i, n in enumerate(nodes) if (n.get('name') or '') == target]
        if not hits:
            out.append(f'  !! {target!r} NOT FOUND in toc.json')
            continue
        for i in hits:
            n = nodes[i]
            out.append(f'--- idx {i} id={n["microKpId"]} name={n["name"]!r} '
                       f'num={n.get("num")!r} page={n.get("printedPage")} '
                       f'depth={n.get("depth")} leaf={n.get("isLeaf")} '
                       f'parent={n.get("parentId")}')
            pid = n.get('parentId')
            sibs = [s for s in nodes if s.get('parentId') == pid]
            sibs.sort(key=lambda s: (s.get('printedPage') or 0, s.get('ordinal') or 0))
            pos = sibs.index(n) if n in sibs else -1
            for j in range(max(0, pos - 3), min(len(sibs), pos + 4)):
                s = sibs[j]
                mark = '>>>' if j == pos else '   '
                out.append(f'   {mark} num={s.get("num")!r:12} p={s.get("printedPage"):<5} '
                           f'{s.get("name")!r}')

io.open('.scratch/t61/frag_ctx.txt', 'w', encoding='utf-8').write('\n'.join(out))
print('written', len(out))
