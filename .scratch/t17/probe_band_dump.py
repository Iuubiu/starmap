import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf, numpy as np
from ocr import OcrEngine, render_page

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
img = render_page(doc, 10, 200)
h, w = img.shape[:2]
x0 = int(w * 0.62)
strip = np.ascontiguousarray(img[:, x0 : int(w * 0.86)])
for score in (0.5, 0.2, 0.05):
    ls = eng.lines(strip, text_score=score)
    print(f'--- score {score}: {len(ls)} lines')
    for l in ls:
        print(f'  y={l.y0:6.0f} x={l.x0+x0:5.0f}-{l.x1+x0:5.0f} c{l.conf:.2f} {l.text!r}')
    if score == 0.2:
        break
