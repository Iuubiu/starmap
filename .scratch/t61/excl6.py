"""收紧后的排除清单定义：cur 无编号 + 页码差≤1 + （前一条以标点结尾 或 cur 名短≤8）→ 像碎片的样子。"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
sys.stdout.reconfigure(encoding='utf-8')

from merge_fragments import _name, _num, _siblings, is_leading_punct_fragment  # noqa: E402

PUNCT = '、，。；：）)（('
for lim in (6, 8, 10):
    tot = 0
    print(f'=== cur 名长 <= {lim} 或 前一条以标点结尾 ===')
    for p in sorted(Path('content').glob('*/toc.json')):
        sid = p.parent.name
        nodes = json.loads(p.read_text(encoding='utf-8'))['nodes']
        n = 0
        for _par, idxs in _siblings(nodes).items():
            for k in range(1, len(idxs)):
                prev, cur = nodes[idxs[k - 1]], nodes[idxs[k]]
                pn, cn = _name(prev), _name(cur)
                if not pn or not cn or is_leading_punct_fragment(cur) or _num(cur):
                    continue
                pp, cp = prev.get('printedPage'), cur.get('printedPage')
                if pp is None or cp is None or abs(cp - pp) > 1:
                    continue
                if pn[-1] in PUNCT or len(cn) <= lim:
                    n += 1
        tot += n
        if n:
            print(f'  {sid}: {n}')
    print('  合计', tot)
