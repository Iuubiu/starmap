import json, sys, collections
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
CONTENT = Path('content')
withorig = []; without = []
for toc_path in sorted(CONTENT.glob('*/toc.json')):
    toc = json.loads(toc_path.read_text(encoding='utf-8'))
    sid = toc.get('sourceId') or toc_path.parent.name
    for n in toc.get('nodes', []):
        name = (n.get('name') or '').strip(); num = (n.get('num') or '').strip()
        orig = (n.get('nameOriginal') or '').strip()
        if num and name.startswith(num + ' '):
            (withorig if orig else without).append((sid, n.get('microKpId'), name, num, orig))
print('with nameOriginal:', len(withorig), ' without:', len(without))
cw = collections.Counter(x[0] for x in withorig); cn = collections.Counter(x[0] for x in without)
print('--- with nameOriginal (translated) ---')
for s,c in cw.most_common(): print(f'   {s}: {c}')
print('--- without nameOriginal (native title) ---')
for s,c in cn.most_common(): print(f'   {s}: {c}')
print('--- sample without ---')
for x in without[:12]: print('   ', x)
