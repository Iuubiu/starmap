import json, sys
from pathlib import Path
sys.path.insert(0,'tools/ingest')
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import pymupdf
from extract import extract_page
d = Path('资源库')/'books'
cands = [p for p in d.iterdir() if 'Debertin' in p.name]
print('found', [p.name for p in cands])
doc = pymupdf.open(cands[0])
print('pages', len(doc))
hit = 0
for pno in range(200, 215):
    blocks = extract_page(doc[pno], pno)
    for b in blocks:
        t = (b.text or '')
        if 'However, in many situations' in t or 'drifts are this small' in t or 'Creagh (1987)' in t:
            hit += 1
            print(f'page {pno} kind={b.kind} len={len(t)} head={t[:60]!r}')
print('hits', hit)
