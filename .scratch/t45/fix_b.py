"""t45 缺陷 B：把译文 name 里嵌的章节编号去掉（改前 457，现 141）。

判据（逐条可核验，不放宽）：
  1. 只处理 `name` 以**自身 num** 开头的节点（`1.6.4.1.1 粒子加速器` 且 num 就是 `1.6.4.1.1`）。
     前缀与 num 不一致的（OCR 噪声、真标题带数字）一律不动。
  2. **只处理译文节点**（`nameOriginal` 非空）。中文原题节点（`nameOriginal` 为空）
     的编号是原书标题自带的（`2.5 仿真例题`、`1.1 概述`、`11.2 SPICE`…），
     剥掉反而与书里印的标题不符 —— 那 55 条按合同保留。
  3. 剥掉编号后，若该书内**已有别的叶节点叫这个名字**，就不能只剥：
     换成「父节点名 + 空格 + 名字」，与 naming.py 的消歧手法一致
     （前端没有 num 字段，只能靠名字区分）。父名拿不到或是自己的前缀时保留原样。
  4. 绝不碰 `num` 字段本身（目录里的真实编号，前端靠它排序）。

用法：python .scratch/t45/fix_b.py [--dry-run]
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

changed = stripped = prefixed = kept = native = 0
samples: list[tuple[str, str, str]] = []

for path in sorted(CONTENT.glob('*/toc.json')):
    doc = json.loads(path.read_text(encoding='utf-8'))
    nodes = doc.get('nodes') or []
    by_id = {n['microKpId']: n for n in nodes}
    leaf_names = Counter(n['name'] for n in nodes if n.get('isLeaf'))
    touched = False

    for n in nodes:
        name = n.get('name') or ''
        m = NUM.match(name)
        if not (m and n.get('num') and m.group(1) == n['num']):
            continue
        base = name[m.end():].strip()
        if not base:
            continue
        if not n.get('nameOriginal'):
            native += 1          # 中文原题自带编号：保留
            continue
        # 剥掉后是否会与本书另一个叶节点重名（自己不算）
        others = leaf_names[base] - (1 if n.get('isLeaf') and name == base else 0)
        if others > 0:
            parent = by_id.get(n.get('parentId')) or {}
            pname = (parent.get('name') or '').strip()
            if not pname or base.startswith(pname):
                kept += 1
                continue
            new_name = f'{pname} {base}'
            prefixed += 1
        else:
            new_name = base
            stripped += 1

        if len(samples) < 8:
            samples.append((path.parent.name, name, new_name))
        n['name'] = new_name
        changed += 1
        touched = True

    if touched and not dry:
        path.write_bytes(
            (json.dumps(doc, ensure_ascii=False, indent=2) + '\n').replace('\n', '\r\n').encode('utf-8')
        )

print(f'{"[dry-run] " if dry else ""}changed={changed} stripped={stripped} prefixed={prefixed} kept={kept} native_kept={native}')
for s in samples:
    print('  ', s[0], '|', s[1], '->', s[2])
