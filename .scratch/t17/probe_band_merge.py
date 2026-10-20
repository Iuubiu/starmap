import sys, glob, time
sys.path.insert(0, 'tools/ingest')
import pymupdf, numpy as np
from ocr import OcrEngine, render_page, parse_toc_ocr, ocr_page

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()

bands = [(0.68, 0.80), (0.65, 0.90), (0.70, 0.86), (0.62, 0.86)]
full = {i: ocr_page(eng, doc, i, text_score=0.2) for i in (10, 11, 12, 13)}
for lo, hi in bands:
    t0 = time.time()
    extra, ents = {}, []
    for i in (10, 11, 12, 13):
        img = render_page(doc, i, 200)
        h, w = img.shape[:2]
        strip = np.ascontiguousarray(img[:, int(w * lo) : int(w * hi)])
        ls = eng.lines(strip, text_score=0.2)
        extra[i] = ls
        ents.extend(parse_toc_ocr(full[i].lines + ls))
    nums = [p for _, _, p in ents]
    bad = sum(1 for a, b in zip(nums, nums[1:]) if b < a)
    print(f'band {lo}-{hi}: {len(ents)} entries, backsteps {bad}, {time.time()-t0:.1f}s')
    for e in ents[:6]:
        print('   ', e)
