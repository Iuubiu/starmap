"""把 67 条仍回退的标题连同父级路径、页码、原文一起列出，供逐条决定译法。"""
import collections
import glob
import json
import re
import sys

sys.path.insert(0, 'tools/ingest')
import translate

PAT = re.compile(r'^未收录术语（(.*)）$')

rows = []
for p in sorted(glob.glob('content/*/toc.json')):
    d = json.load(open(p, encoding='utf-8'))
    nodes = d['nodes']
    byid = {n['microKpId']: n for n in nodes}
    for n in nodes:
        name = n['name']
        if not name.startswith('未收录术语'):
            continue
        out = translate.translate_title(name)
        if not out.startswith('未收录术语'):
            continue
        cur, chain = n, [n]
        while cur.get('parentId') and cur['parentId'] in byid and cur['depth'] > 0:
            cur = byid[cur['parentId']]
            chain.append(cur)
        chain.reverse()
        path = ' / '.join(f"{c.get('num') or ''} {c['name']}".strip() for c in chain[:-1])
        inner = PAT.match(name)
        rows.append((d['sourceId'], inner.group(1) if inner else name, n.get('num'), n.get('printedPage'), path))

rows.sort()
for sid, inner, num, page, path in rows:
    print(f'{sid}\t{num}\tp{page}\t{inner!r}\tPARENT: {path[:120]}')
print(f'\ntotal fallback nodes: {len(rows)}  distinct inner: {len({r[1] for r in rows})}')
