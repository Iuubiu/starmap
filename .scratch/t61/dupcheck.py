import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

BOOKS = [
    'analog-electronics-tongshibai-5e',
    'nuclear-physics-experiment-methods-1997',
    'nuclear-radiation-physics-chenboxian-2011',
    'radiation-detector-handbook-jichangsong-1990',
    'radiation-detectors-dinghonglin-2010',
]

for sid in BOOKS:
    p = Path('content') / sid / 'toc.json'
    d = json.loads(p.read_text(encoding='utf-8'))
    nodes = d['nodes']
    by_name = {}
    for n in nodes:
        by_name.setdefault((n.get('name') or '').strip(), []).append(n['microKpId'])
    dups = {k: v for k, v in by_name.items() if len(v) > 1}
    # 也检查「名字是否被 disambiguate 拼过编号」的形态（例如 "3.2.1 一、概述"）
    print(f'{sid}: nodes={len(nodes)} dupNames={len(dups)}')
    for k, v in dups.items():
        print('   DUP', repr(k), v)
