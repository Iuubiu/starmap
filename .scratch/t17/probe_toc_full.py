import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf, numpy as np
from ocr import OcrEngine, render_page, parse_toc_pages, OcrLine, ocr_page
from toc import build_tree, flatten

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
pages = []
for i in (10, 11, 12, 13):
    p = ocr_page(eng, doc, i, text_score=0.2)
    img = render_page(doc, i, 200)
    h, w = img.shape[:2]
    x0 = int(w * 0.62)
    ls = eng.lines(np.ascontiguousarray(img[:, x0 : int(w * 0.86)]), text_score=0.2)
    moved = [OcrLine(l.text, l.conf, l.x0 + x0, l.y0, l.x1 + x0, l.y1) for l in ls]
    p.lines = [l for l in p.lines if l.x0 < x0] + moved
    pages.append(p)
ents = parse_toc_pages(pages)
print('entries', len(ents), 'numbered', sum(1 for n, _, _ in ents if n))
for num, title, page in ents:
    print(f'[{num:>7}] {title}  p.{page}')
print('nodes', len(flatten(build_tree(ents))))
