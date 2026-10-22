import json, subprocess, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
rows = subprocess.run(['node','.scratch/t17/q.mjs',
    "select source_id, count(*) c from app.knowledge_points where source_id is not null group by 1 order by 1;"],
    capture_output=True, text=True, encoding='utf-8')
db = {}
for line in rows.stdout.splitlines():
    line=line.strip()
    if line.startswith('{') and 'source_id' in line:
        d=json.loads(line); db[d['source_id']]=int(d['c'])
mis=[]
for p in sorted(Path('content').glob('*/toc.json')):
    sid=p.parent.name
    n=len(json.loads(p.read_text(encoding='utf-8'))['nodes'])
    if db.get(sid)!=n: mis.append((sid,n,db.get(sid)))
print('books',len(list(Path('content').glob('*/toc.json'))),'mismatch',len(mis))
for m in mis: print('  MISMATCH',m)
