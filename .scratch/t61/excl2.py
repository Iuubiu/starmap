"""「同父 + 同页 + 本节点无编号」但被拒的相邻对有多少 —— 这是 AC③ 排除清单的自然定义。"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
sys.stdout.reconfigure(encoding='utf-8')

from merge_fragments import DANGLING, _name, _num, _siblings, is_leading_punct_fragment  # noqa: E402

BOOKS = [
    'analog-electronics-tongshibai-5e',
    'nuclear-physics-experiment-methods-1997',
    'nuclear-radiation-physics-chenboxian-2011',
    'radiation-detector-handbook-jichangsong-1990',
    'radiation-detectors-dinghonglin-2010',
]
tot = 0
for sid in BOOKS:
    nodes = json.loads((Path('content') / sid / 'toc.json').read_text(encoding='utf-8'))['nodes']
    hits = []
    for _p, idxs in _siblings(nodes).items():
        for k in range(1, len(idxs)):
            prev, cur = nodes[idxs[k - 1]], nodes[idxs[k]]
            pn, cn = _name(prev), _name(cur)
            if not pn or not cn:
                continue
            if is_leading_punct_fragment(cur) or _num(cur):
                continue
            if cur.get('printedPage') != prev.get('printedPage'):
                continue
            hits.append((prev['microKpId'], pn, cn, pn[-1] in DANGLING))
    tot += len(hits)
    print(f'{sid}: {len(hits)}  (其中前一条以悬空连接词结尾的 {sum(1 for h in hits if h[3])})')
    for h in hits[:6]:
        print(f'    {h[0]} {h[1]!r} -> {h[2]!r}')
print('合计', tot)
