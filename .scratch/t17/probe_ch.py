import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf
from ocr import OcrEngine, ocr_page, parse_toc_ocr, toc_band_lines, _merge_toc_band, _toc_denoise, _assign_nums, _CH_MARK

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
ents = []
for i in (10, 11, 12, 13):
    p = ocr_page(eng, doc, i, text_score=0.2)
    band, x0 = toc_band_lines(eng, doc, i)
    e = parse_toc_ocr(_merge_toc_band(list(p.lines), band, x0))
    print(f'p{i}: lines={len(p.lines)} band={len(band)} entries={len(e)}')
    ents.extend(e)
print('--- raw titles containing 第')
for num, t, pg in ents:
    if _CH_MARK.match(t):
        print('  CH:', repr(t), pg)
d = _toc_denoise(ents)
print('after denoise', len(d))
a = _assign_nums(d)
print('numbered', sum(1 for n, _, _ in a if n))
for n, t, pg in a[:6]:
    print(f'  [{n}] {t} {pg}')
