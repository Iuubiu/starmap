import sys, json, re
sys.path.insert(0,'tools/ingest')
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from pathlib import Path
import pymupdf
from extract import extract_page, _looks_like_formula
from books_batch import BODY_START

TARGET = 'ck-debertin-1988-0208-01-d6b37ee9da16'
chunks = [json.loads(l) for l in open('content/debertin-1988/chunks.jsonl',encoding='utf-8')]
c = next(x for x in chunks if x['id']==TARGET)
print('chunk kind', c['kind'], 'ordinal', c.get('ordinal'), 'bbox', c.get('bbox'))
head = c['text'][:60]
# find which PDF page: scan pages for the text
pdf = Path('content-src/debertin-1988.pdf')
if not pdf.exists():
    import glob
    cand = glob.glob('**/debertin*.pdf', recursive=True)
    print('candidates', cand)
    pdf = Path(cand[0])
doc = pymupdf.open(str(pdf))
print('pages', doc.page_count)
for i in range(doc.page_count):
    t = doc[i].get_text()
    if head[:40].replace('\n',' ') in t.replace('\n',' '):
        print('found on pdf page index', i)
        for ws in (True, False):
            blocks = extract_page(doc[i], i, word_spaces=ws)
            for b in blocks:
                if head[:30].replace('\n',' ') in b.text.replace('\n',' '):
                    print(f'  ws={ws} block kind={b.kind!r} level={b.level} rows={len(b.rows) if b.rows else 0} len={len(b.text)} looks_formula={_looks_like_formula(b.text, 9.0)}')
        break
doc.close()
