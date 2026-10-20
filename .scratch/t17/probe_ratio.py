import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf, numpy as np
from ocr import OcrEngine, render_page, _toc_page_number

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
e = eng._engine


def nums(lines):
    out = []
    for ln in lines:
        v = _toc_page_number(ln.text)
        if v is not None:
            out.append((round(ln.y0), v, round(ln.x1), ln.text))
    return out


for ratio, minh in ((8, 30), (40, 30), (80, 20), (200, 12)):
    e.width_height_ratio = ratio
    e.min_height = minh
    tot = 0
    detail = {}
    for idx in (10, 11, 12, 13):
        img = render_page(doc, idx, 200)
        ns = nums(eng.lines(img))
        detail[idx] = len(ns)
        tot += len(ns)
    print(f'ratio={ratio:3d} min_height={minh:2d} total={tot} per_page={detail}')
