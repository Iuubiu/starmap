# -*- coding: utf-8 -*-
import json, subprocess
from pathlib import Path
REPO = Path('.').resolve()

def counts(text):
    n=0; ans=0
    for line in text.splitlines():
        if not line.strip(): continue
        c=json.loads(line); n+=1
        if c.get('answer_for'): ans+=1
    return n,ans

rows=[]
for p in sorted((REPO/'content').glob('*/chunks.jsonl')):
    sid=p.parent.name
    r=subprocess.run(['git','show',f'HEAD:content/{sid}/chunks.jsonl'],capture_output=True,text=True,encoding='utf-8')
    if r.returncode!=0:
        rows.append((sid,None,None,None,None)); continue
    b,ba=counts(r.stdout); a,aa=counts(p.read_text('utf-8'))
    rows.append((sid,b,ba,a,aa))

changed=[]; same=0
for sid,b,ba,a,aa in rows:
    if b is None: print(f'{sid:<44} (no HEAD)'); continue
    if (b,ba)!=(a,aa):
        changed.append((sid,b,ba,a,aa))
    else:
        same+=1
print(f'unchanged books: {same}')
print('changed books:')
for sid,b,ba,a,aa in changed:
    print(f'  {sid:<44} {b}->{a} chunks   {ba}->{aa} answer')
