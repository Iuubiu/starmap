import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf, numpy as np, cv2
from ocr import OcrEngine, render_page, _toc_page_number, OcrPage, parse_toc_pages
from ocr import _assign_nums, _toc_denoise
from toc import build_tree, flatten

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()


def num_lines(lines):
    out = []
    for ln in lines:
        v = _toc_page_number(ln.text)
        if v is not None:
            out.append((ln.y0, ln.x1, v))
    return out


results = {}
for idx in (10, 11, 12, 13):
    img = render_page(doc, idx, 200)
    h, w = img.shape[:2]
    full = num_lines(eng.lines(img))
    strip_img = np.ascontiguousarray(img[:, int(w * 0.70) :])
    up = cv2.resize(strip_img, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
    strip = num_lines(eng.lines(up))
    # 只保留页面范围内的 y
    strip = [(y / 2.0, v) for y, _, v in strip if y / 2.0 < h]
    merge = {}
    for y, x, v in full:
        merge.setdefault(round(y / 12), []).append((v, 1))
    for y, v in strip:
        merge.setdefault(round(y / 12), []).append((v, 2))
    results[idx] = merge
    print(f'p{idx} full={len(full)} strip2x={len(strip)} union_keys={len(merge)}')
