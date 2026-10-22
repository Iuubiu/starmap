import csv, json, pathlib
root = pathlib.Path('content')
rows = []
for toc in sorted(root.glob('*/toc.json')):
    d = json.loads(toc.read_text(encoding='utf-8'))
    sid = d.get('sourceId') or toc.parent.name
    for n in d.get('nodes', []):
        if not n.get('isLeaf'):
            continue
        rows.append((sid, n.get('microKpId'), n.get('num') or '', n.get('name'), n.get('printedPage'), n.get('depth')))
with open('.scratch/t36/leaves.tsv', 'w', encoding='utf-8', newline='') as f:
    w = csv.writer(f, delimiter='\t')
    for r in rows:
        w.writerow(r)
print('rows', len(rows))
