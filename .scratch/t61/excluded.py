"""统计：前一条以悬空连接词结尾、但没被合并的相邻对，以及各自卡在哪条判据。"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
sys.stdout.reconfigure(encoding='utf-8')

from merge_fragments import DANGLING, _num, _siblings, is_leading_punct_fragment  # noqa: E402

BOOKS = [
    'analog-electronics-tongshibai-5e',
    'nuclear-physics-experiment-methods-1997',
    'nuclear-radiation-physics-chenboxian-2011',
    'radiation-detector-handbook-jichangsong-1990',
    'radiation-detectors-dinghonglin-2010',
]

total = 0
for sid in BOOKS:
    nodes = json.loads((Path('content') / sid / 'toc.json').read_text(encoding='utf-8'))['nodes']
    near = []
    for _parent, idxs in _siblings(nodes).items():
        for k in range(1, len(idxs)):
            prev, cur = nodes[idxs[k - 1]], nodes[idxs[k]]
            pn, cn = (prev.get('name') or '').strip(), (cur.get('name') or '').strip()
            if not pn or not cn:
                continue
            if pn[-1] not in DANGLING:
                continue
            reasons = []
            if is_leading_punct_fragment(cur):
                reasons.append('cur 以标点开头（A 类，不是续行）')
            if _num(cur):
                reasons.append(f'cur 有编号 {_num(cur)!r}')
            if cur.get('printedPage') != prev.get('printedPage'):
                reasons.append(f'不同页 {prev.get("printedPage")} vs {cur.get("printedPage")}')
            if reasons:
                near.append((prev['microKpId'], pn, cn, reasons))
    total += len(near)
    print(f'{sid}: 被看过但未合并 {len(near)}')
    for pid, pn, cn, rs in near:
        print(f'    {pid}: {pn!r} + {cn!r}  排除理由: {"; ".join(rs)}')

print('\n合计:', total)
