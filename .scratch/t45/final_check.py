import json, re, sys, collections
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
NUM = re.compile(r'^\s*(\d+(?:\.\d+)+)\s+')
LEAD = re.compile(r'^\s*(?:\d+(?:\.\d+)*\.?|[IVXLC]+\.|[A-Z]\.\d+(?:\.\d+)*\.?|\d+(?:\.\d+)*\.[A-Z]\.?)\s+')
def norm(s): return re.sub(r'\s+','',NUM.sub('',(s or '').lower()))
A=B=0; Anodes=Bnodes=0; native=0; C=0
for p in sorted(Path('content').glob('*/toc.json')):
    ns=json.loads(p.read_text(encoding='utf-8'))['nodes']
    g=collections.defaultdict(set)
    for n in ns:
        g[n['name']].add(norm(n.get('nameOriginal','')))
        if NUM.match(n['name']) and (NUM.match(n['name']).group(1)==(n.get('num') or '')):
            if n.get('nameOriginal'): B+=1
            else: native+=1
        if n['name'].strip() in ('1131','g:1343'): C+=1
    for k,v in g.items():
        v.discard('')
        if len(v)>1: A+=1; Anodes+=len(v)
print(f'A groups={A} nodes={Anodes}  B translated={B} native={native}  C={C}')
