import collections, glob, json, os, re, psycopg

pat = re.compile(r'^未收录术语（(.*)）$')
rows = []
with psycopg.connect('postgres://postgres:postgres@127.0.0.1:5432/starmap', options='-c search_path=app,public') as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT source_id, id, name, is_leaf FROM knowledge_points WHERE name LIKE '未收录术语%'")
        rows = cur.fetchall()

print('DB total', len(rows), 'leaves', sum(1 for r in rows if r[3]))
by_book = collections.Counter(r[0] for r in rows)
print('by book', dict(by_book))

inner = collections.Counter()
for _, _, name, _ in rows:
    m = pat.match(name)
    inner[m.group(1) if m else name] += 1
print('distinct inner', len(inner))
for k, v in inner.most_common():
    print(f'{v}\t{k}')

# also from toc.json
toc_counter = collections.Counter()
for p in sorted(glob.glob('content/*/toc.json')):
    d = json.load(open(p, encoding='utf-8'))
    for n in d.get('nodes', []):
        if n['name'].startswith('未收录术语'):
            m = pat.match(n['name'])
            toc_counter[m.group(1) if m else n['name']] += 1
print('\nTOC total', sum(toc_counter.values()), 'distinct', len(toc_counter))
