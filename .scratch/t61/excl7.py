"""候选定义候选方案对比：哪种只留下「看起来像碎片尾巴」的对。"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
sys.stdout.reconfigure(encoding='utf-8')

from merge_fragments import _name, _num, _siblings, is_leading_punct_fragment  # noqa: E402

PUNCT = '、，。；：）)（('
BOOKS = [
    'analog-electronics-tongshibai-5e',
    'nuclear-physics-experiment-methods-1997',
    'nuclear-radiation-physics-chenboxian-2011',
    'radiation-detector-handbook-jichangsong-1990',
    'radiation-detectors-dinghonglin-2010',
]


def collect(sid, pred):
    nodes = json.loads((Path('content') / sid / 'toc.json').read_text(encoding='utf-8'))['nodes']
    out = []
    for _par, idxs in _siblings(nodes).items():
        for k in range(1, len(idxs)):
            prev, cur = nodes[idxs[k - 1]], nodes[idxs[k]]
            pn, cn = _name(prev), _name(cur)
            if not pn or not cn or is_leading_punct_fragment(cur) or _num(cur):
                continue
            pp, cp = prev.get('printedPage'), cur.get('printedPage')
            if pp is None or cp is None or abs(cp - pp) > 1:
                continue
            if pred(pn, cn):
                out.append((prev['microKpId'], pn, cn))
    return out


VARIANTS = {
    'A: 前一条以标点结尾': lambda pn, cn: pn[-1] in PUNCT,
    'B: 前一条短(<=6) 或 以标点结尾': lambda pn, cn: len(pn) <= 6 or pn[-1] in PUNCT,
    'C: 本节点短(<=12) 且 前一条是它的2倍长': lambda pn, cn: len(cn) <= 12 and len(pn) >= 2 * len(cn),
    'D: B 或 C': lambda pn, cn: (len(pn) <= 6 or pn[-1] in PUNCT) or (len(cn) <= 12 and len(pn) >= 2 * len(cn)),
}
for label, pred in VARIANTS.items():
    per = {sid: len(collect(sid, pred)) for sid in BOOKS}
    print(f'{label}: 合计 {sum(per.values())}  {per}')
