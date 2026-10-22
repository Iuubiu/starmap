"""统计：若把 B 类判据放宽到只差一条，会命中多少对？用来决定排除清单的粒度。"""
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
            if is_leading_punct_fragment(cur):
                continue
            if _num(cur):
                continue
            if cur.get('printedPage') != prev.get('printedPage'):
                continue
            # 到这里：无编号 + 同页 + 非标点开头，只差「前一条以悬空连接词结尾」
            near.append((prev['microKpId'], cn, pn))
    total += len(near)
    print(f'{sid}: 近失对 {len(near)}')
    for pid, cn, pn in near[:8]:
        print(f'    prev={pid} prevName={pn!r} cur={cn!r}')

print('\n合计近失对:', total)
