import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf
from ocr import OcrEngine, ocr_page, parse_toc_ocr, toc_band_lines, _merge_toc_band, _toc_page_number

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
for i in (10, 11, 12, 13):
    p = ocr_page(eng, doc, i, text_score=0.2)
    band, x0 = toc_band_lines(eng, doc, i, text_score=0.05)
    print(f'--- p{i} band {len(band)} x0={x0:.0f}')
    print('   ', sorted((round(l.y0), _toc_page_number(l.text)) for l in band if _toc_page_number(l.text)))
