import json, pathlib, re, unicodedata
from collections import Counter, defaultdict

root = pathlib.Path('content')
LAYER_ORD = {'circuit-analysis':10,'analog-electronics':20,'digital-electronics':30,
             'atomic-nuclear-physics':40,'nuclear-electronics':50,'radiation-detection':60,
             'radiation-measurement-methods':70,'advanced-digital':80}
cmap = json.loads(pathlib.Path('content/course-map.json').read_text(encoding='utf-8'))
BOOK_LAYER = {b['sourceId']: b['layerId'] for b in cmap['books']}

NOISE = re.compile(r'未收录术语|术语表|目录|索引|参考文献|习题|附录|题解|解答|小结|概述|导言|绪论|前言')
NUM_PREFIX = re.compile(r'^\s*(?:第\s*[0-9一二三四五六七八九十百]+\s*[章节篇]|[0-9]+(?:\s*[.．\-]\s*[0-9]+)*|[一二三四五六七八九十]+\s*[、.．]|[§$]\s*[0-9.\-]+)\s*')
PAREN = re.compile(r'[（(][^（()）]*[)）]')
PUNCT = re.compile(r'[\s，。、；：？！,.;:?!"\'“”‘’（）()\[\]【】<>《》\-—–_/\|·．.]+')

def norm(name):
    s = unicodedata.normalize('NFKC', name or '')
    s = NUM_PREFIX.sub('', s)
    s = PAREN.sub('', s)
    s = PUNCT.sub('', s)
    return s

leaves = []
for toc in sorted(root.glob('*/toc.json')):
    d = json.loads(toc.read_text(encoding='utf-8'))
    sid = d['sourceId']
    for n in d['nodes']:
        if not n.get('isLeaf'):
            continue
        leaves.append({'book': sid, 'id': n['microKpId'], 'name': n['name'],
                       'num': n.get('num') or '', 'page': n.get('printedPage'),
                       'norm': norm(n['name'])})

by_norm = defaultdict(list)
for n in leaves:
    if len(n['norm']) < 4 or NOISE.search(n['name']):
        continue
    by_norm[n['norm']].append(n)

pairs = []
for key, group in by_norm.items():
    books = {g['book'] for g in group}
    if len(books) < 2:
        continue
    for a in group:
        for b in group:
            if a['book'] == b['book']:
                continue
            la, lb = BOOK_LAYER.get(a['book']), BOOK_LAYER.get(b['book'])
            if not la or not lb or LAYER_ORD[la] >= LAYER_ORD[lb]:
                continue
            pairs.append((key, a, b))

print('pairs', len(pairs), 'distinct concepts', len({p[0] for p in pairs}))
c = Counter((p[1]['book'], p[2]['book']) for p in pairs)
for k, v in c.most_common():
    print(v, k[0], '->', k[1])
print('--- concepts')
for k in sorted({p[0] for p in pairs}):
    print(k)
