import json, sys
from pathlib import Path
sys.path.insert(0,'tools/ingest')
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import pymupdf
from extract import extract_page
d = Path('\u8d44\u6e90\u5e93')/'books'
cands = [p for p in d.iterdir() if p.name.startswith('debertin-1988_') and p.suffix=='.pdf']
print('found', [p.name for p in cands])
doc = pymupdf.open(cands[0])
print('pages', len(doc))
for pno in (206,207,208,209):
    blocks = extract_page(doc[pno], pno)
    for b in blocks:
        t = (b.text or '')
        if 'However, in many situations' in t or 'drifts are this small' in t or 'Creagh (1987)' in t:
            print(f'page {pno} kind={b.kind} len={len(t)} head={t[:70]!r}')
