"""票面点名的三对 C 类：逐对取出两个节点的完整字段，看是哪条判据排除的。"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
sys.stdout.reconfigure(encoding='utf-8')

from merge_fragments import DANGLING, _name, _num  # noqa: E402

PAIRS = [
    ('digital-kanghua-5e', '附录A', '附录B'),
    ('nuclear-physics-experiment-methods-1997', '同轴型HPGe', 'HPGe探测器的主要性能'),
    ('nuclear-physics-experiment-methods-1997', '探测器望远镜与飞行时间', '超灵敏加速器质谱仪'),
]

for sid, a, b in PAIRS:
    p = Path('content') / sid / 'toc.json'
    nodes = json.loads(p.read_text(encoding='utf-8'))['nodes']
    print(f'=== {sid} ===')
    for want in (a, b):
        for i, n in enumerate(nodes):
            if want in _name(n):
                print(
                    f'  idx={i} id={n["microKpId"]} name={_name(n)!r} num={_num(n)!r} '
                    f'parent={n.get("parentId")} page={n.get("printedPage")} leaf={n.get("isLeaf")}'
                )
