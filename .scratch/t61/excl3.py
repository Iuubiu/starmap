"""「近失候选」定义：同父、本节点无编号、页码差 ≤1、名字不以标点开头 —— 票面判据 2 的宽松版。"""
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
    'digital-kanghua-5e',
    'digital-kanghuaguang-5e',
]
tot = 0
for sid in BOOKS:
    p = Path('content') / sid / 'toc.json'
    if not p.exists():
        continue
    nodes = json.loads(p.read_text(encoding='utf-8'))['nodes']
    hits = []
    for _par, idxs in _siblings(nodes).items():
        for k in range(1, len(idxs)):
            prev, cur = nodes[idxs[k - 1]], nodes[idxs[k]]
            pn, cn = _name(prev), _name(cur)
            if not pn or not cn:
                continue
            if is_leading_punct_fragment(cur) or _num(cur):
                continue
            pp, cp = prev.get('printedPage'), cur.get('printedPage')
            if pp is None or cp is None or abs(cp - pp) > 1:
                continue
            hits.append((prev['microKpId'], pn, cp - pp, cn, pn[-1] in DANGLING))
    tot += len(hits)
    print(f'{sid}: {len(hits)}')
print('合计', tot)
