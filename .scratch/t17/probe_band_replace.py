import sys, glob, time
sys.path.insert(0, 'tools/ingest')
import pymupdf, numpy as np
from ocr import OcrEngine, render_page, parse_toc_ocr, ocr_page, OcrLine

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()

full = {i: ocr_page(eng, doc, i, text_score=0.2) for i in (10, 11, 12, 13)}
for lo, hi in ((0.68, 0.80), (0.62, 0.86)):
    t0 = time.time()
    ents = []
    for i in (10, 11, 12, 13):
        img = render_page(doc, i, 200)
        h, w = img.shape[:2]
        x0 = int(w * lo)
        strip = np.ascontiguousarray(img[:, x0 : int(w * hi)])
        ls = eng.lines(strip, text_score=0.2)
        moved = [OcrLine(l.text, l.conf, l.x0 + x0, l.y0, l.x1 + x0, l.y1) for l in ls]
        left = [l for l in full[i].lines if l.x0 < x0]
        ents.extend(parse_toc_ocr(left + moved))
    nums = [p for _, _, p in ents]
    bad = sum(1 for a, b in zip(nums, nums[1:]) if b < a)
    print(f'band {lo}-{hi}: {len(ents)} entries, backsteps {bad}, {time.time()-t0:.1f}s')
    for e in ents[:8]:
        print('   ', e)
