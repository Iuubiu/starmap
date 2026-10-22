import json, sys
from pathlib import Path
sys.path.insert(0,'tools/ingest')
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from extract import _looks_like_formula
CONTENT = Path('content')
def ar(t):
    return sum(1 for c in t if c.isascii() and c.isalpha())/max(1,len(t))
def has_zh(t):
    return any('\u4e00'<=ch<='\u9fff' for ch in t)
EN = ['debertin-1988','tsoulfanidis-4e','leo-2e','lutz-2007','knoll-3e-2000','knoll-4e-2010','gilmore-2e-2008']
for book in EN:
    f = CONTENT/book/'chunks.jsonl'
    rows = [json.loads(l) for l in f.read_text(encoding='utf-8').splitlines()]
    for c in rows:
        t = c.get('text') or ''
        if c.get('kind')=='formula' and len(t)>200 and ar(t)>0.55 and not has_zh(t):
            parts = c['id'].rsplit('-',2)
            page = parts[0].rsplit('-',1)[-1]
            sibs = [x for x in rows if x['id'].startswith(f'ck-{book}-{page}-{parts[1]}-')]
            joined = ''.join((x.get('text') or '') for x in sibs)
            print(f'{book:16s} {c["id"]:34s} len={len(t):5d} nSib={len(sibs)}')
            print(f'   block: len={len(joined):5d} ar={ar(joined):.2f} zh={has_zh(joined)} looksFormula={_looks_like_formula(joined, 9.0)}')
            print(f'   piece: len={len(t):5d} ar={ar(t):.2f} looksFormula={_looks_like_formula(t, 9.0)}')
            print(f'   piece_head: {t[:150]!r}')
