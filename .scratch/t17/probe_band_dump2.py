import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf
from ocr import OcrEngine, ocr_page, toc_band_lines, _toc_page_number

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
for i in (11, 12):
    band, x0 = toc_band_lines(eng, doc, i, text_score=0.05)
    print(f'--- p{i}')
    for l in sorted(band, key=lambda l: l.y0):
        print(f'  y={l.y0:6.0f} x={l.x0:5.0f}-{l.x1:5.0f} c{l.conf:.2f} {l.text!r} -> {_toc_page_number(l.text)}')
