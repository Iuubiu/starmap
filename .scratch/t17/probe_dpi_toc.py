import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf
from ocr import OcrEngine, render_page, _toc_page_number

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
for dpi in (200, 250, 300):
    img = render_page(doc, 10, dpi)
    ls = eng.lines(img)
    nums = [(round(l.y0), l.text, _toc_page_number(l.text)) for l in ls if _toc_page_number(l.text) is not None]
    print(f'dpi={dpi} lines={len(ls)} numeric={len(nums)} first6={nums[:6]}')
