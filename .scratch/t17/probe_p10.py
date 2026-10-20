import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf
from ocr import OcrEngine, ocr_page, parse_toc_ocr, toc_band_lines, _merge_toc_band

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
for i in (10,):
    p = ocr_page(eng, doc, i, text_score=0.2)
    band, x0 = toc_band_lines(eng, doc, i)
    e = parse_toc_ocr(_merge_toc_band(list(p.lines), band, x0))
    for row in e[:12]:
        print(row)
    print('---- lines in left column ----')
    for l in sorted([l for l in p.lines if l.x0 < x0], key=lambda l: l.y0)[:14]:
        print(f'{l.y0:7.0f} x{l.x0:5.0f}-{l.x1:5.0f} conf{l.conf:.2f} {l.text!r}')
