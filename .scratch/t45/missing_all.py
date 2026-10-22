import io, json, sys, collections
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(Path('tools/ingest').resolve()))
import translate as T

CONTENT = Path('content')
cnt = collections.Counter()
per_book = {}
tot = 0
for p in sorted(CONTENT.glob('*/toc.json')):
    d = json.load(io.open(p, encoding='utf-8'))
    sid = d.get('sourceId') or p.parent.name
    T._MISSING.clear()
    n = 0
    for node in d.get('nodes', []):
        orig = (node.get('nameOriginal') or '').strip()
        if not orig:
            continue
        n += 1
        T.translate_title(T._normalize(orig))
    per_book[sid] = (n, sum(T._MISSING.values()), len(T._MISSING))
    cnt.update(T._MISSING)
    tot += n
print('nodes with nameOriginal:', tot)
print('books:', len(per_book))
print('distinct missing words:', len(cnt), 'total occurrences:', sum(cnt.values()))
print()
for w, c in cnt.most_common(400):
    print(f'{c:5d}  {w}')
