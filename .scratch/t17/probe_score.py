import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf
from ocr import OcrEngine, render_page, _toc_page_number

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
e = eng._engine
img = render_page(doc, 10, 200)

for score in (0.5, 0.2, 0.0):
    e.text_score = score
    rows = sorted(eng.lines(img), key=lambda l: l.y0)
    top = [l for l in rows if 380 <= l.y0 <= 800]
    print(f'--- text_score={score} total={len(rows)} band380-800={len(top)}')
    for l in top:
        print(f'    y0={l.y0:6.0f} x0={l.x0:6.0f} x1={l.x1:6.0f} c={l.conf:.2f} {l.text!r}')
