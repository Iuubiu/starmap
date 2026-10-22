import json, sys, pathlib
root = pathlib.Path('content')
want = set(sys.argv[1:])
for toc in sorted(root.glob('*/toc.json')):
    d = json.loads(toc.read_text(encoding='utf-8')); sid = d['sourceId']
    nodes = d['nodes']
    byid = {n['microKpId']: n for n in nodes}
    for n in nodes:
        if n['microKpId'] in want:
            # walk up to depth 1
            cur = n; chain = [cur]
            while cur.get('parentId') and cur['parentId'] in byid and cur['depth'] > 1:
                cur = byid[cur['parentId']]; chain.append(cur)
            chain.reverse()
            path = ' / '.join(f"{c.get('num') or ''} {c['name']}".strip() for c in chain)
            print(f"{sid}\t{n['microKpId']}\t{path}\tp{n.get('printedPage')}\tdepth{n['depth']}")
