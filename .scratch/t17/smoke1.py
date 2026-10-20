import sys, time
sys.path.insert(0, 'tools/ingest')
import pymupdf
from ocr import OcrEngine, ocr_page, boxes_to_blocks

BOOK = '资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf'
doc = pymupdf.open(BOOK)
t0 = time.time()
eng = OcrEngine()
print(f'engine ready in {time.time()-t0:.2f}s')

for i in [10, 60, 61, 100]:
    p = ocr_page(eng, doc, i)
    print(f'===== p{i} status={p.status} conf={p.mean_conf:.3f} lines={p.line_count} chars={p.char_count} blocks={len(p.blocks)} figs={len(p.figures)} footer={p.footer_page} {p.elapsed:.2f}s {p.error}')
    for b in p.blocks[:10]:
        print(f'   {b.kind:9s} lvl={b.level} {b.text[:70]!r}')
    for f in p.figures:
        print(f'   FIG {[round(v) for v in f["bbox"]]} cap={f["caption"][:50]!r}')
