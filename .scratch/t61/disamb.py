import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
sys.stdout.reconfigure(encoding='utf-8')

from naming import disambiguate_duplicate_names  # noqa: E402

BOOKS = [
    'analog-electronics-tongshibai-5e',
    'nuclear-physics-experiment-methods-1997',
    'nuclear-radiation-physics-chenboxian-2011',
    'radiation-detector-handbook-jichangsong-1990',
    'radiation-detectors-dinghonglin-2010',
]

for sid in BOOKS:
    d = json.loads((Path('content') / sid / 'toc.json').read_text(encoding='utf-8'))
    nodes = copy.deepcopy(d['nodes'])
    changes = disambiguate_duplicate_names(nodes)
    print(f'{sid}: disambiguate would rename {len(changes)}')
    for c in changes[:6]:
        print('   ', c)
