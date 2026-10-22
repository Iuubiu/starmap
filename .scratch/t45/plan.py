import io, json, sys, re, collections
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(Path('tools/ingest').resolve()))
import translate as T

CONTENT = Path('content')
NUM = re.compile(r'^\s*(\d+(?:\.\d+)*)\s+')

def load(p):
    return json.load(io.open(p, encoding='utf-8'))

# ---- defect A groups + which words are missing to distinguish them
print('===== DEFECT A: missing words per collapsed group =====')
groups_total = 0
nodes_total = 0
need_words = collections.Counter()
for p in sorted(CONTENT.glob('*/toc.json')):
    d = load(p); sid = d.get('sourceId') or p.parent.name
    byname = collections.defaultdict(list)
    for n in d.get('nodes', []):
        byname[n.get('name') or ''].append(n)
    for name, ns in byname.items():
        origs = { (n.get('nameOriginal') or '') for n in ns }
        if len(origs) < 2: continue
        groups_total += 1; nodes_total += len(ns)
        for o in origs:
            if not o: continue
            T._MISSING.clear()
            T.translate_title(T._normalize(o))
            for w in T._MISSING: need_words[w] += 1
print('groups', groups_total, 'nodes', nodes_total)
print('words needed:', len(need_words), 'occurrences', sum(need_words.values()))
for w,c in need_words.most_common():
    print(f'  {c:3d}  {w}')

# ---- defect B: where do numbers come from?
print()
print('===== DEFECT B: number source =====')
src_naming = 0; src_translate = 0; native = 0
samples = []
for p in sorted(CONTENT.glob('*/toc.json')):
    d = load(p); sid = d.get('sourceId') or p.parent.name
    for n in d.get('nodes', []):
        name = n.get('name') or ''; num = (n.get('num') or '').strip()
        if not num: continue
        if not name.startswith(num): continue
        orig = (n.get('nameOriginal') or '').strip()
        if not orig:
            native += 1; continue
        fresh = T.translate_title(T._normalize(orig))
        if fresh.startswith(num):
            src_translate += 1
            samples.append((sid, num, orig, fresh, 'TRANSLATE'))
        else:
            src_naming += 1
            samples.append((sid, num, orig, fresh, 'NAMING'))
print('native (nameOriginal empty):', native)
print('from naming.py prefix      :', src_naming)
print('from translate_title itself:', src_translate)
print()
print('--- TRANSLATE-sourced samples ---')
for s in samples:
    if s[4]=='TRANSLATE': print(' ', s)
print('--- NAMING-sourced samples (first 15) ---')
c=0
for s in samples:
    if s[4]=='NAMING' and c<15: print(' ', s); c+=1
