import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf
from ocr import OcrEngine, ocr_page, parse_toc_ocr, toc_band_lines, _merge_toc_band, _toc_page_number

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
p10 = ocr_page(eng, doc, 10, text_score=0.2)
band, x0 = toc_band_lines(eng, doc, 10, text_score=0.05)
lines = _merge_toc_band(list(p10.lines), band, x0)
print(f'--- merged lines x0={x0:.0f}: {len(lines)}')
for l in sorted(lines, key=lambda l: l.y0)[:16]:
    print(f'  y={l.y0:6.0f} x={l.x0:5.0f}-{l.x1:5.0f} c{l.conf:.2f} {l.text!r} num={_toc_page_number(l.text)}')
print('--- entries (no denoise)')
for e in parse_toc_ocr(lines)[:14]:
    print(f'   [{e[0]}] {e[1]!r} {e[2]}')
