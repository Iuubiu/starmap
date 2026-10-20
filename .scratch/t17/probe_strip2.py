import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf, numpy as np
from ocr import OcrEngine, render_page, _toc_page_number

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
img = render_page(doc, 10, 200)
h, w = img.shape[:2]
strip = np.ascontiguousarray(img[:, int(w * 0.68) :])
for score in (0.5, 0.2, 0.05):
    ls = eng.lines(strip, text_score=score)
    got = [(round(l.y0), _toc_page_number(l.text), l.text) for l in ls]
    got = [g for g in got if g[1] is not None]
    print(f'score={score}: {len(got)} -> {got[:12]}')
