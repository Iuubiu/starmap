import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf, numpy as np, cv2
from ocr import OcrEngine, render_page, _toc_page_number

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
img = render_page(doc, 10, 200)
h, w = img.shape[:2]
for lo, hi in ((0.70, 0.88), (0.72, 0.86), (0.74, 0.84), (0.70, 0.88)):
    for fx in (1, 2):
        crop = img[:, int(w * lo) : int(w * hi)]
        if fx > 1:
            crop = cv2.resize(crop, None, fx=fx, fy=fx, interpolation=cv2.INTER_CUBIC)
        ls = eng.lines(np.ascontiguousarray(crop), text_score=0.05)
        got = sorted((round(l.y0 / fx), _toc_page_number(l.text)) for l in ls)
        got = [g for g in got if g[1] is not None]
        print(f'{lo}-{hi} x{fx}: {len(got)} {got[:10]}')
