# -*- coding: utf-8 -*-
"""AC5 另一半：抽 30 个「改后仍是 formula」的块，确认是真公式（没有靠放宽判据把散文留下）。"""
from __future__ import annotations

import json
import random
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
rng = random.Random(20261022)

pool = []
for path in sorted((REPO / 'content').glob('*/chunks.jsonl')):
    sid = path.parent.name
    for line in path.read_text('utf-8').splitlines():
        if not line.strip():
            continue
        c = json.loads(line)
        if c['kind'] == 'formula':
            pool.append((sid, c['id'], c['text']))

print(f'formula 总数: {len(pool)}')
print()
for sid, cid, text in rng.sample(pool, 30):
    print(f'{sid}  {cid}')
    print(f'  {text[:110]!r}')
