import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf, numpy as np, cv2
from ocr import OcrEngine, render_page

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
img = render_page(doc, 10, 200)
crop = img[370:580, 1230:1400]
cv2.imwrite('.scratch/t17/pn_zoom.png', cv2.resize(crop, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC))
for fx in (1, 2, 3):
    big = cv2.resize(crop, None, fx=fx, fy=fx, interpolation=cv2.INTER_CUBIC)
    ls = eng.lines(big, text_score=0.05)
    print(f'x{fx}:', [(l.text, round(l.conf, 2), round(l.y0 / fx + 370)) for l in ls])
