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
# 只比对 27 本有 toc.json 的书
mism=[(s,tocs[s],db.get(s)) for s in sorted(tocs) if tocs[s]!=db.get(s)]
print(f'books {len(tocs)}  mismatch {len(mism)}')
for m in mism: print('  MISMATCH',m)
print('db book total', sum(db.get(s,0) for s in tocs))
print('toc node total', sum(tocs.values()))
