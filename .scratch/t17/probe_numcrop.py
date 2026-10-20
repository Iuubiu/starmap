import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf, numpy as np, cv2
from ocr import OcrEngine, render_page, _toc_page_number

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
img = render_page(doc, 10, 200)
h, w = img.shape[:2]
print('page', w, h)

# 未配对的标题 y 带（p10 前 8 行），真值页码应为 1,1,1,1,2,5,8,10
targets = [401, 447, 493, 536, 576, 616, 657, 696]
for scale in (1.0, 2.0, 3.0):
    hits = []
    for y0 in targets:
        y1, y2 = max(0, y0 - 22), min(h, y0 + 32)
        crop = np.ascontiguousarray(img[y1:y2, int(w * 0.68):])
        if scale != 1.0:
            crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        ls = eng.lines(crop)
        cand = [(ln.text, _toc_page_number(ln.text), round(ln.conf, 2)) for ln in ls]
        cand = [c for c in cand if c[1] is not None]
        hits.append(cand[0][1] if cand else None)
    print(f'scale={scale} -> {hits}')
