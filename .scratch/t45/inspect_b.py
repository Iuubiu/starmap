import json, sys, collections
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
CONTENT = Path('content')
CN = {'analog-electronics-kanghuaguang-5e','analog-electronics-tongshibai-5e','circuit-analysis-lihansun-5e-vol1',
      'digital-electronics-yanshi-6e','digital-kanghua-5e','nuclear-electronics-wangjingjin-1983',
      'nuclear-electronics-wangzhiying-1989','nuclear-physics-experiment-methods-1997',
      'nuclear-radiation-measurement-tangbin','nuclear-radiation-physics-chenboxian-2011',
      'radiation-detector-handbook-jichangsong-1990','radiation-detectors-dinghonglin-2010'}
for toc_path in sorted(CONTENT.glob('*/toc.json')):
    toc = json.loads(toc_path.read_text(encoding='utf-8'))
    sid = toc.get('sourceId') or toc_path.parent.name
    hits = []
    for n in toc.get('nodes', []):
        name = (n.get('name') or '').strip(); num = (n.get('num') or '').strip()
        if num and name.startswith(num + ' '):
            hits.append((n.get('microKpId'), name, num, (n.get('nameOriginal') or '')))
    if hits and sid in CN:
        print(f'== {sid} ({len(hits)})')
        for h in hits[:25]:
            print('   ', h)
