"""只统计「前一条名以标点结尾」的近似对（票面判据 2 的字面读法）。"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
sys.stdout.reconfigure(encoding='utf-8')

from merge_fragments import _name, _num, _siblings, is_leading_punct_fragment  # noqa: E402

BOOKS = sorted(p.parent.name for p in Path('content').glob('*/toc.json'))
PUNCT = '、，。；：）)（('
tot = 0
for sid in BOOKS:
    nodes = json.loads((Path('content') / sid / 'toc.json').read_text(encoding='utf-8'))['nodes']
    hits = []
    for _par, idxs in _siblings(nodes).items():
        for k in range(1, len(idxs)):
            prev, cur = nodes[idxs[k - 1]], nodes[idxs[k]]
            pn, cn = _name(prev), _name(cur)
            if not pn or not cn or is_leading_punct_fragment(cur) or _num(cur):
                continue
            pp, cp = prev.get('printedPage'), cur.get('printedPage')
            if pp is None or cp is None or abs(cp - pp) > 1:
                continue
            if pn[-1] not in PUNCT:
                continue
            hits.append((prev['microKpId'], pn, cn))
    if hits:
        tot += len(hits)
        print(f'{sid}: {len(hits)}')
        for h in hits:
            print(f'    {h[0]} {h[1]!r} -> {h[2]!r}')
print('合计', tot)
