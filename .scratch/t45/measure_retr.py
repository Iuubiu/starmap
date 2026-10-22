import io, json, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(Path('tools/ingest').resolve()))
import translate as T
from naming import disambiguate_duplicate_names

TR = T.make_translator(T.load_overrides())
CONTENT = Path('content')
BOOKS = ['ahmed-2e','debertin-1988','gilmore-2e-2008','grupen-2e-2008','knoll-3e-2000',
         'knoll-4e-2010','leo-2e','lutz-2007','nakhostin-2018','nicholson-1974',
         'rivetti-2015','spieler-2005','tsoulfanidis-4e']
total = changed = 0
per = {}
for sid in BOOKS:
    p = CONTENT / sid / 'toc.json'
    if not p.is_file():
        print('missing', sid); continue
    d = json.load(io.open(p, encoding='utf-8'))
    nodes = d.get('nodes', [])
    c = 0
    for n in nodes:
        orig = n.get('nameOriginal') or ''
        if not orig:
            continue
        new = TR(orig) or orig
        if new != n.get('name'):
            c += 1
    total += len(nodes); changed += c
    per[sid] = (len(nodes), c)
print('nodes', total, 'would_change', changed)
for k,v in per.items(): print(' ', k, v)
