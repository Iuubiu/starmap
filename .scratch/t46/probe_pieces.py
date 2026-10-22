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
    rows = [json.loads(l) for l in (CONTENT/book/'chunks.jsonl').read_text(encoding='utf-8').splitlines()]
    for c in rows:
        t = c.get('text') or ''
        if c.get('kind')=='formula' and len(t)>200 and ar(t)>0.55 and not has_zh(t):
            page = c['id'].rsplit('-',2)[0].rsplit('-',1)[-1]
            sibs = [x for x in rows if x['id'].startswith(f'ck-{book}-{page}-')]
            joined = ''.join((x.get('text') or '') for x in sibs)
            print(f'{book:16s} {c["id"]:34s} pieceLen={len(t):5d} nPiece={len(sibs)} blockLen={len(joined):5d} blockAr={ar(joined):.2f} blockZh={has_zh(joined)} blockLooksFormula={_looks_like_formula(joined, 9.0)}')
