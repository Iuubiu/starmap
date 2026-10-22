import json, re, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0,'tools/ingest')
from translate import translate_title, _strip_number
CONTENT = Path('content')
rows=[]
for p in sorted(CONTENT.glob('*/toc.json')):
    sid=p.parent.name
    nodes=json.loads(p.read_text(encoding='utf-8')).get('nodes',[])
    for n in nodes:
        num=(n.get('num') or '').strip(); nm=n.get('name') or ''; orig=(n.get('nameOriginal') or '').strip()
        if not num or not re.match(r'^\d+(\.\d+)+ ', nm) or not nm.startswith(num+' '): continue
        if not orig: continue
        tr = translate_title(orig)
        rows.append((sid, nm, num, orig, tr))
print('translated B rows:', len(rows))
# 分类：翻译本身带编号 vs naming 加的
own = [r for r in rows if r[4].startswith(r[2])]
added = [r for r in rows if not r[4].startswith(r[2])]
print('translate_title 自身带编号:', len(own))
print('naming 加的（译文无编号）:', len(added))
for r in own[:12]: print('  OWN ', r[0], '|', r[1], '| num', r[2], '| orig', r[3], '| tr', r[4])
for r in added[:8]: print('  ADD ', r[0], '|', r[1], '| num', r[2], '| orig', r[3], '| tr', r[4])
# added 里，去掉前缀后在同书内是否重名？
import collections
for sid in sorted({r[0] for r in added}):
    nodes=json.loads((CONTENT/sid/'toc.json').read_text(encoding='utf-8')).get('nodes',[])
    names=collections.Counter(n.get('name') or '' for n in nodes)
    dup=0
    for r in added:
        if r[0]!=sid: continue
        base=r[1][len(r[2])+1:]
        if names.get(base,0)>1: dup+=1
    print(f'  {sid}: added={sum(1 for r in added if r[0]==sid)} 去前缀后仍重名={dup}')
