import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf, numpy as np
from ocr import OcrEngine, render_page, parse_toc_ocr, OcrLine, ocr_page

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
p = ocr_page(eng, doc, 10, text_score=0.2)
img = render_page(doc, 10, 200)
h, w = img.shape[:2]
x0 = int(w * 0.62)
ls = eng.lines(np.ascontiguousarray(img[:, x0 : int(w * 0.86)]), text_score=0.2)
moved = [OcrLine(l.text, l.conf, l.x0 + x0, l.y0, l.x1 + x0, l.y1) for l in ls]
p.lines = [l for l in p.lines if l.x0 < x0] + moved
print('raw lines', len(p.lines))
for e in parse_toc_ocr(p.lines)[:14]:
    print('  ', e)
