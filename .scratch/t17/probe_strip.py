import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf, numpy as np
from ocr import OcrEngine, render_page, _toc_page_number

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
for idx in (10, 11, 12, 13):
    img = render_page(doc, idx, 200)
    h, w = img.shape[:2]
    full = [(round(l.y0), _toc_page_number(l.text)) for l in eng.lines(img)]
    full = [n for n in full if n[1] is not None]
    strip_img = np.ascontiguousarray(img[:, int(w * 0.70):])
    strip = [(round(l.y0), _toc_page_number(l.text)) for l in eng.lines(strip_img)]
    strip = [n for n in strip if n[1] is not None]
    print(f'p{idx}: full={len(full)} strip={len(strip)}')
    print(f'   full  {full[:10]}')
    print(f'   strip {strip[:10]}')
