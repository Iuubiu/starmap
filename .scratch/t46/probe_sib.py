import json, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
CONTENT = Path('content')
def ar(t):
    return sum(1 for c in t if c.isascii() and c.isalpha())/max(1,len(t))
for book in ['debertin-1988','tsoulfanidis-4e','leo-2e','lutz-2007','knoll-3e-2000','knoll-4e-2010','gilmore-2e-2008']:
    f = CONTENT/book/'chunks.jsonl'
    rows = [json.loads(l) for l in f.read_text(encoding='utf-8').splitlines()]
    by_id = {c['id']: c for c in rows}
    for c in rows:
        t = c.get('text') or ''
        if c.get('kind')=='formula' and len(t)>200 and ar(t)>0.55:
            # page prefix: ck-<book>-<page>-<i>-<hash>
            parts = c['id'].rsplit('-',2)
            page = parts[0].rsplit('-',1)[-1]
            sibs = [x for x in rows if x['id'].startswith(f'ck-{book}-{page}-')]
            joined = ''.join((x.get('text') or '') for x in sibs)
            print(f'{book:16s} {c["id"]:34s} len={len(t):5d} sibs={len(sibs)} joined_has_eq={"=" in joined} self_has_eq={"=" in t}')
