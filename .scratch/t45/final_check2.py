import json, re, sys, collections
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
# 剥掉任意形态的章节编号：1.6.E / 2.6.A / A.8 / 10.1.A / 13.2.1.4 / 6:2
LEAD = re.compile(r'^\s*(?:[A-Z]\.)?\d+(?:[.:]\d+)*(?:\.[A-Z])?\.?\s+', re.I)
def norm(s):
    t = (s or '').strip()
    prev=None
    while prev!=t:
        prev=t; t = LEAD.sub('', t)
    return re.sub(r'\s+','', t).lower()
groups=[]
for p in sorted(Path('content').glob('*/toc.json')):
    ns=json.loads(p.read_text(encoding='utf-8'))['nodes']
    g=collections.defaultdict(set)
    for n in ns: g[n['name']].add(norm(n.get('nameOriginal','')))
    for k,v in g.items():
        v.discard('')
        if len(v)>1: groups.append((p.parent.name,k,sorted(v)))
print('A groups after number-normalisation:', len(groups))
for x in groups: print('  ',x)
