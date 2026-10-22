import glob, json
TARGET = set('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
for p in sorted(glob.glob('content/*/toc.json')):
    d = json.load(open(p, encoding='utf-8'))
    nodes = d['nodes']
    byid = {n['microKpId']: n for n in nodes}
    for n in nodes:
        if n['name'].startswith('未收录术语（') and n['name'].endswith('）'):
            inner = n['name'][len('未收录术语（'):-1]
            if inner in TARGET or inner in ('ADCs','NaI(Tl)','CsI(Tl)','CsI(Na)','CaF2(Eu)','LiI(Eu)'):
                cur = n; chain = [cur]
                while cur.get('parentId') and cur['parentId'] in byid and cur['depth'] > 0:
                    cur = byid[cur['parentId']]; chain.append(cur)
                chain.reverse()
                path = ' / '.join(f"{c.get('num') or ''} {c['name']}".strip() for c in chain)
                print(f"{d['sourceId']}\tinner={inner!r}\td{n['depth']}\tp{n.get('printedPage')}\t{path[:160]}")
