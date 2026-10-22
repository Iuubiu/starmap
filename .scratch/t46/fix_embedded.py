"""t46 收尾：把 7 个「译文 name 里嵌了自己编号」的叶节点改成不带编号且互不重名的名字。

为什么会有这 7 个：t45 的 `fix_b2.py` 剥编号时，若「剥完会与别的叶节点重名」就用
**父节点名**做前缀；但下面这几组的父节点名恰好等于自身名或彼此相同，于是被 `kept`
跳过，编号留在 name 里，`test_translated_names_do_not_embed_their_own_number` 红。

修法（按可靠度依次尝试，都不行才保留）：
1. 用 `nameOriginal` 重新译一遍（`translate_title` 会剥掉原文里的 `3.2 ` 这类前导编号）；
2. 仍与别的叶重名 → 前缀用**祖先链上第一个在该重名组内唯一的名字**（父名相同就往上找）；
3. 祖先链也无法区分（同一父节点下的兄弟）→ 在括号里补原文，保证可区分且不含纯编号前缀。
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools' / 'ingest'))
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from translate import translate_title  # noqa: E402

CONTENT = Path(__file__).resolve().parents[2] / 'content'
NUM = re.compile(r'^\s*(\d+(?:\.\d+)+)\s+')
dry = '--dry-run' in sys.argv


def ancestors(by_id: dict, node: dict) -> list[str]:
    out, cur = [], by_id.get(node.get('parentId') or '')
    while cur:
        out.append(NUM.sub('', (cur.get('name') or '')).strip())
        cur = by_id.get(cur.get('parentId') or '')
    return out


def base_of(node: dict) -> str:
    orig = (node.get('nameOriginal') or '').strip()
    if orig:
        tr = translate_title(orig).strip()
        if tr and '未收录术语' not in tr:
            return tr
    return NUM.sub('', (node.get('name') or '')).strip()


total = 0
for path in sorted(CONTENT.glob('*/toc.json')):
    doc = json.loads(path.read_text(encoding='utf-8'))
    nodes = doc.get('nodes') or []
    by_id = {n['microKpId']: n for n in nodes}

    targets = []
    for n in nodes:
        m = NUM.match(n.get('name') or '')
        if m and n.get('num') and m.group(1) == n['num'] and (n.get('nameOriginal') or '').strip():
            targets.append((n, base_of(n)))
    if not targets:
        continue

    tid = {t[0]['microKpId'] for t in targets}
    others = Counter((n.get('name') or '').strip() for n in nodes
                     if n.get('isLeaf') and n['microKpId'] not in tid)
    planned = Counter(b for _, b in targets)

    for n, base in targets:
        chain = ancestors(by_id, n)
        cand = base
        if planned[base] > 1 or others.get(cand, 0) > 0:
            cand = ''
            for anc in chain:                      # 祖先链上第一个能区分的名字
                trial = f'{anc} {base}'
                if planned[trial] == 0 and others.get(trial, 0) == 0:
                    cand = trial
                    break
            if not cand:                           # 兄弟同父：补原文
                orig = (n.get('nameOriginal') or '').strip()
                cand = f'{base}（{orig}）'
                if planned[cand] > 1:
                    cand = f'{base}（{orig}·{n["num"]}）'
            # 从 planned 里减掉旧 base，登记新候选
        planned[base] -= 1
        planned[cand] += 1
        print(f'{path.parent.name} | {n["microKpId"]} | {n["name"]!r} -> {cand!r}')
        n['name'] = cand
        total += 1

    if not dry:
        path.write_bytes((json.dumps(doc, ensure_ascii=False, indent=2) + '\n').replace('\n', '\r\n').encode('utf-8'))

print(('[dry-run] ' if dry else '') + f'renamed={total}')
