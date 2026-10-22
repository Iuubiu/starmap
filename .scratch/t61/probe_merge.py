"""探测 B 类判据的召回/误报：找「前一兄弟名以悬空连接词结尾 + 本节点无 num + 同父同页」的节点。

只读，不改任何文件。
"""
import io
import json
import re
from pathlib import Path

#: 中文标题不会以这些字结尾（它们是连接词/助词，后面必然还有内容）。
DANGLING = '的与和及或在对把从向以之为于而并'

PUNCT = re.compile(r'^[、，。；：）)]')

rows = []
for path in sorted(Path('content').glob('*/toc.json')):
    sid = path.parent.name
    doc = json.loads(path.read_text(encoding='utf-8'))
    nodes = doc.get('nodes', [])
    by_parent = {}
    for i, n in enumerate(nodes):
        by_parent.setdefault(n.get('parentId'), []).append((i, n))
    for parent_id, group in by_parent.items():
        group.sort(key=lambda t: (t[1].get('printedPage') or 0, t[0]))
        for k in range(1, len(group)):
            prev = group[k - 1][1]
            cur = group[k][1]
            prev_name = (prev.get('name') or '').strip()
            cur_name = (cur.get('name') or '').strip()
            if not prev_name or not cur_name:
                continue
            if PUNCT.match(cur_name):
                continue
            if prev_name[-1] not in DANGLING:
                continue
            if (cur.get('num') or '').strip():
                continue
            if cur.get('printedPage') != prev.get('printedPage'):
                continue
            rows.append(
                (
                    sid,
                    prev.get('microKpId'),
                    prev_name,
                    cur.get('microKpId'),
                    cur_name,
                    cur.get('printedPage'),
                    cur.get('depth'),
                    cur.get('isLeaf'),
                )
            )

print(f'命中 {len(rows)} 处')
for r in rows:
    print(f'[{r[0]}] p{r[5]} d{r[6]} leaf={r[7]}')
    print(f'    prev {r[1]}\n         {r[2]!r}')
    print(f'    cur  {r[3]}\n         {r[4]!r}')
