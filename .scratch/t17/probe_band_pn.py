import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf, numpy as np
from ocr import OcrEngine, render_page, _toc_page_number

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
img = render_page(doc, 10, 200)
h, w = img.shape[:2]
print('w', w, 'number col x1 ~1337 ->', round(1337 / w, 3))
for lo, hi in ((0.68, 0.80), (0.70, 0.79), (0.72, 0.79), (0.68, 1.0), (0.75, 0.79)):
    strip = np.ascontiguousarray(img[:, int(w * lo) : int(w * hi)])
    for score in (0.5, 0.2):
        ls = eng.lines(strip, text_score=score)
        got = [(_toc_page_number(l.text), round(l.y0)) for l in ls]
        got = [g for g in got if g[0] is not None]
        print(f'band {lo}-{hi} score={score}: {len(got)} {got[:14]}')
