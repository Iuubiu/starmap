import json, pathlib, re, unicodedata
from collections import defaultdict
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
    s = NUM_PREFIX.sub('', s); s = PAREN.sub('', s); s = PUNCT.sub('', s)
    return s
leaves=[]
for toc in sorted(root.glob('*/toc.json')):
    d=json.loads(toc.read_text(encoding='utf-8')); sid=d['sourceId']
    for n in d['nodes']:
        if n.get('isLeaf'):
            leaves.append({'book':sid,'id':n['microKpId'],'name':n['name'],'num':n.get('num') or '','page':n.get('printedPage'),'norm':norm(n['name'])})
by=defaultdict(list)
for n in leaves:
    if len(n['norm'])<4 or NOISE.search(n['name']): continue
    by[n['norm']].append(n)
want = set()
for a in __import__('sys').argv[1:]:
    x,y=a.split('>'); want.add((x,y))
for key,g in sorted(by.items()):
    for a in g:
        for b in g:
            if a['book']==b['book']: continue
            la,lb=BOOK_LAYER.get(a['book']),BOOK_LAYER.get(b['book'])
            if not la or not lb or LAYER_ORD[la]>=LAYER_ORD[lb]: continue
            if (a['book'],b['book']) in want:
                print(f"{key}\t{a['book']}:{a['id']}:{a['name']}(p{a['page']})\t->\t{b['book']}:{b['id']}:{b['name']}(p{b['page']})")
