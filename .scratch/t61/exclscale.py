"""量一下「被看过但没合并」的候选对规模，挑一个能逐条列出、又不淹没输出的定义。"""
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
]

# 候选定义 A：cur 无编号 + 同页 + cur 名字很短（<=6 字）——「像个碎片」
for limit in (4, 6, 8):
    print(f'--- 定义：无编号 + 同页 + cur 名长 <= {limit} ---')
    tot = 0
    for sid in BOOKS:
        nodes = json.loads((Path('content') / sid / 'toc.json').read_text(encoding='utf-8'))['nodes']
        hits = []
        for _p, idxs in _siblings(nodes).items():
            for k in range(1, len(idxs)):
                prev, cur = nodes[idxs[k - 1]], nodes[idxs[k]]
                cn = (cur.get('name') or '').strip()
                if not cn or is_leading_punct_fragment(cur) or _num(cur):
                    continue
                if cur.get('printedPage') != prev.get('printedPage'):
                    continue
                if len(cn) > limit:
                    continue
                hits.append((prev.get('name'), cn))
        tot += len(hits)
        print(f'  {sid}: {len(hits)}')
    print(f'  合计 {tot}')
