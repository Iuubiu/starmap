"""C 类误报的三种形状在数据里到底长什么样（决定排除清单怎么写）。"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
sys.stdout.reconfigure(encoding='utf-8')

from merge_fragments import _num, _siblings, is_leading_punct_fragment  # noqa: E402

BOOKS = [
    'analog-electronics-tongshibai-5e',
    'nuclear-physics-experiment-methods-1997',
    'nuclear-radiation-physics-chenboxian-2011',
    'radiation-detector-handbook-jichangsong-1990',
    'radiation-detectors-dinghonglin-2010',
    'digital-kanghua-5e',
]

ORDINALS = '一二三四五六七八九十'

for sid in BOOKS:
    p = Path('content') / sid / 'toc.json'
    if not p.exists():
        continue
    nodes = json.loads(p.read_text(encoding='utf-8'))['nodes']
    found = []
    for _par, idxs in _siblings(nodes).items():
        for k in range(1, len(idxs)):
            prev, cur = nodes[idxs[k - 1]], nodes[idxs[k]]
            pn, cn = (prev.get('name') or '').strip(), (cur.get('name') or '').strip()
            if not pn or not cn:
                continue
            if is_leading_punct_fragment(cur) or _num(cur):
                continue
            if cur.get('printedPage') != prev.get('printedPage'):
                continue
            both_appendix = pn.startswith('附录') and cn.startswith('附录')
            both_ordinal = pn[:1] in ORDINALS and cn[:1] in ORDINALS and pn[1:2] in '、.' and cn[1:2] in '、.'
            if both_appendix or both_ordinal:
                found.append((prev['microKpId'], pn, cur['microKpId'], cn))
    if found:
        print(f'=== {sid} ===')
        for pid, pn, cid, cn in found:
            print(f'   {pid}: {pn!r}  |  {cid}: {cn!r}')
