import json, re, sys, collections
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
CONTENT = Path('content')
NUM_RE = re.compile(r'^\d+(?:\.\d+)+ ')
tot = 0; bycat = collections.Counter(); samples = collections.defaultdict(list)
for toc_path in sorted(CONTENT.glob('*/toc.json')):
    toc = json.loads(toc_path.read_text(encoding='utf-8'))
    sid = toc.get('sourceId') or toc_path.parent.name
    for n in toc.get('nodes', []):
        name = (n.get('name') or '').strip(); num = (n.get('num') or '').strip()
        orig = (n.get('nameOriginal') or '').strip()
        m = NUM_RE.match(name)
        if not m: continue
        prefix = m.group(0).strip()
        if prefix != num: continue
        tot += 1
        cat = 'translated' if orig else 'native'
        bycat[cat] += 1
        samples[cat].append((sid, n.get('microKpId'), name, num, orig))
print('total (regex + prefix==num):', tot, dict(bycat))
print('--- native (no nameOriginal) ---')
for s,c in collections.Counter(x[0] for x in samples['native']).most_common(): print(f'   {s}: {c}')
for x in samples['native']: print('     ', x)
