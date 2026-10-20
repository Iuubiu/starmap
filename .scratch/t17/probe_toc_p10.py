import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf
from ocr import OcrEngine, ocr_page, parse_toc_ocr, _CHAPTER_ONLY

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
p = ocr_page(eng, doc, 10)
raw = parse_toc_ocr(p.lines)
print('page10 entries', len(raw))
for num, title, page in raw[:12]:
    print(f'  [{num}] {title!r} p.{page}')
print('--- lines containing 第 ---')
for ln in p.lines:
    if '第' in ln.text or '章' in ln.text:
        print(f'  x0={ln.x0:6.0f} x1={ln.x1:6.0f} y0={ln.y0:6.0f} {ln.text!r}')
