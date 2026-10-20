import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf
from ocr import OcrEngine, ocr_page, _toc_page_number

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
p = ocr_page(eng, doc, 10)
rows = sorted(p.lines, key=lambda l: (l.y0, l.x0))
for ln in rows:
    tag = 'NUM' if _toc_page_number(ln.text) is not None else '   '
    print(f'{tag} y0={ln.y0:6.0f} x0={ln.x0:5.0f} x1={ln.x1:5.0f} c={ln.conf:.2f} {ln.text!r}')
