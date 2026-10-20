import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf, numpy as np
from ocr import OcrEngine, render_page, _toc_page_number

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
det = eng._engine.text_detector

def nums(lines):
    return [(round(l.y0), _toc_page_number(l.text)) for l in lines if _toc_page_number(l.text) is not None]

for idx in (10, 11, 12):
    img = render_page(doc, idx, 200)
    h, w = img.shape[:2]
    strip_img = np.ascontiguousarray(img[:, int(w * 0.70):])
    base = set(n for _, n in nums(eng.lines(img)))
    strip = set(n for _, n in nums(eng.lines(strip_img)))
    print(f'p{idx} full={len(base)} strip={len(strip)} union={len(base | strip)} only-strip={sorted(strip - base)}')
    old = det.box_thresh
    det.box_thresh = 0.3
    low = set(n for _, n in nums(eng.lines(img)))
    det.box_thresh = old
    print(f'   box_thresh=0.3 full={len(low)} extra={sorted(low - base)}')
