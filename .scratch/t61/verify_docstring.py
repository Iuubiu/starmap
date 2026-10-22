import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

# 核实 merge_fragments.py docstring 里那句「methods-1997 的 `、概述` → `概述`，
# 同书还有别的「概述」」到底成不成立。
sid = 'nuclear-physics-experiment-methods-1997'
nodes = json.loads((Path('content') / sid / 'toc.json').read_text(encoding='utf-8'))['nodes']
hits = [(n['microKpId'], n.get('num'), n.get('isLeaf')) for n in nodes if '概述' in (n.get('name') or '')]
print('含「概述」的节点：')
for h in hits:
    print('  ', h)

# 另外统计：改动后全库 5 本书里，还有多少「同名叶节点组」？
BOOKS = [
    'analog-electronics-tongshibai-5e',
    'nuclear-physics-experiment-methods-1997',
    'nuclear-radiation-physics-chenboxian-2011',
    'radiation-detector-handbook-jichangsong-1990',
    'radiation-detectors-dinghonglin-2010',
]
print()
for b in BOOKS:
    ns = json.loads((Path('content') / b / 'toc.json').read_text(encoding='utf-8'))['nodes']
    leaves = [n for n in ns if n.get('isLeaf') is True]
    groups = {}
    for n in leaves:
        groups.setdefault((n.get('name') or '').strip(), []).append(n)
    dup = {k: len(v) for k, v in groups.items() if len(v) > 1}
    print(f'{b}: 叶 {len(leaves)}，同名叶组 {len(dup)} -> {list(dup)[:5]}')
