"""t45 缺陷 B 的正确实现：剥掉译文 name 里的自身编号，且保证剥完不同名。

上一版（fix_b.py）的缺陷：判断「剥掉后会不会与别的叶节点重名」时用的是
**当前**的 name 计数，而其他节点也正要被剥 —— 两个 `2.2.1 弹性散射` /
`2.6.1.1 弹性散射` 各自看到「别人还带着编号」，于是都剥成 `弹性散射`，
重名又回来了（实测 4 个 pytest 红就是这么产生的）。

这一版先算出「剥完之后的 base 分布」，base 只出现一次的才剥；出现多次的
改用**父节点名**做前缀（与 naming.py 的消歧手法一致，且不含数字编号，
不会触发 test_translated_names_do_not_embed_their_own_number）。
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

CONTENT = Path(__file__).resolve().parents[2] / 'content'
NUM = re.compile(r'^\s*(\d+(?:\.\d+)+)\s+')
dry = '--dry-run' in sys.argv

stripped = prefixed = native = kept = 0
samples: list[tuple[str, str, str]] = []

for path in sorted(CONTENT.glob('*/toc.json')):
    doc = json.loads(path.read_text(encoding='utf-8'))
    nodes = doc.get('nodes') or []
    by_id = {n['microKpId']: n for n in nodes}

    # 1) 找出所有「译文 + name 以自身 num 开头」的节点，算出它们的 base
    targets = []
    for n in nodes:
        name = n.get('name') or ''
        m = NUM.match(name)
        if not (m and n.get('num') and m.group(1) == n['num']):
            continue
        base = name[m.end():].strip()
        if not base:
            continue
        if not n.get('nameOriginal'):
            native += 1            # 中文原题自带编号：保留
            continue
        targets.append((n, base))

    if not targets:
        continue

    # 2) 剥完后的 base 分布（含原本就叫这个名字的其他节点）
    other_names = Counter(
        (n.get('name') or '').strip() for n in nodes
        if n.get('isLeaf') and n['microKpId'] not in {t[0]['microKpId'] for t in targets}
    )
    planned = Counter(base for _, base in targets)

    touched = False
    for n, base in targets:
        collides = planned[base] > 1 or other_names.get(base, 0) > 0
        if not collides:
            new_name = base
            stripped += 1
        else:
            parent = by_id.get(n.get('parentId')) or {}
            pname = (parent.get('name') or '').strip()
            pname = NUM.sub('', pname).strip()
            if not pname or base.startswith(pname) or pname == base:
                kept += 1
                continue
            new_name = f'{pname} {base}'
            prefixed += 1
        if len(samples) < 10:
            samples.append((path.parent.name, n['name'], new_name))
        n['name'] = new_name
        touched = True

    if touched and not dry:
        path.write_bytes(
            (json.dumps(doc, ensure_ascii=False, indent=2) + '\n').replace('\n', '\r\n').encode('utf-8')
        )

print(f'{"[dry-run] " if dry else ""}stripped={stripped} prefixed={prefixed} kept={kept} native_kept={native}')
for s in samples:
    print('  ', s[0], '|', s[1], '->', s[2])
