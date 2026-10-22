# -*- coding: utf-8 -*-
import json, subprocess
from pathlib import Path
REPO = Path('.').resolve()
tocs = {}
for p in sorted((REPO/'content').glob('*/toc.json')):
    tocs[p.parent.name] = len(json.loads(p.read_text('utf-8'))['nodes'])
sql = "select coalesce(source_id,'(null)') as source_id, count(*) as count from app.knowledge_points group by source_id order by source_id;"
out = subprocess.run(['node','.scratch/t17/q.mjs',sql], capture_output=True, text=True, encoding='utf-8').stdout
db = {}
for line in out.splitlines():
    line=line.strip()
    if line.startswith('{'):
        r=json.loads(line)
        if 'source_id' in r and 'count' in r:
            db[str(r['source_id'])]=int(r['count'])
keys = sorted(set(tocs)|set(db), key=str)
mism=[(s,tocs.get(s),db.get(s)) for s in keys if tocs.get(s)!=db.get(s)]
print('tocs',len(tocs),'db',len(db),'mismatch',len(mism))
for m in mism: print('  MISMATCH',m)
