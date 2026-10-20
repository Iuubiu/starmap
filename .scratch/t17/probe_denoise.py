import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf
from ocr import OcrEngine, ocr_page, parse_toc_ocr, _toc_denoise, _assign_nums

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
for idx in (10, 11, 12, 13):
    p = ocr_page(eng, doc, idx)
    raw = parse_toc_ocr(p.lines)
    den = _toc_denoise(raw)
    asg = _assign_nums(den)
    print(f'p{idx}: raw={len(raw)} denoised={len(den)} numbered={sum(1 for n,_,_ in asg if n)}')
    for num, title, page in raw[:4]:
        print(f'    raw  [{num}] {title!r} p.{page}')
    for num, title, page in asg[:4]:
        print(f'    kept [{num}] {title!r} p.{page}')
