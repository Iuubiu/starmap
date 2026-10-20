"""Probe 7: det cost knobs and render resolution.

RapidOCR default det: limit_type='min', limit_side_len=736. On a 200-dpi render
(2423x1740) min side = 1740 >= 736, so ratio = 1.0 and DB detection runs on the
FULL page -> det dominates. Test 'max' downscaling and native-resolution raster.
"""
import sys
import time

import cv2
import numpy as np
import pymupdf

SITE = 'C:/Users/Yhwhy/scoop/apps/python/current/Lib/site-packages/rapidocr_onnxruntime/'
sys.path.insert(0, SITE)
from rapidocr_onnxruntime import RapidOCR

BOOK = '资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf'
PAGES = [60, 61, 62, 63, 64, 65, 66, 67, 68, 69]


def render(doc, i, dpi):
    pix = doc[i].get_pixmap(dpi=dpi)
    a = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
    if pix.n == 1:
        a = np.repeat(a, 3, axis=2)
    return np.ascontiguousarray(a[:, :, :3][:, :, ::-1])


def native(doc, i):
    """Decode the embedded scan at its own resolution."""
    xref = doc[i].get_images(full=True)[0][0]
    d = doc.extract_image(xref)
    a = cv2.imdecode(np.frombuffer(d['image'], np.uint8), cv2.IMREAD_COLOR)
    return a


def run(label, engine, imgs):
    tot = 0.0
    rows = 0
    chars = 0
    confs = []
    for im in imgs:
        t0 = time.time()
        res, el = engine(im)
        tot += time.time() - t0
        if res:
            rows += len(res)
            chars += sum(len(r[1]) for r in res)
            confs.extend(float(r[2]) for r in res)
    n = len(imgs)
    print(f'{label}: {tot/n:.2f}s/page rows={rows/n:.0f} chars={chars/n:.0f} '
          f'meanConf={np.mean(confs):.3f} medConf={np.median(confs):.3f}')
    return res


if __name__ == '__main__':
    doc = pymupdf.open(BOOK)
    variants = {
        'dpi200': [render(doc, i, 200) for i in PAGES],
        'dpi256': [render(doc, i, 256) for i in PAGES],
        'native': [native(doc, i) for i in PAGES],
    }
    for name, imgs in variants.items():
        print(name, imgs[0].shape)

    eng = RapidOCR()
    print('--- default det (limit min 736) ---')
    base = run('dpi200', eng, variants['dpi200'])
    run('dpi256', eng, variants['dpi256'])
    run('native', eng, variants['native'])

    print('--- det limit max 960 ---')
    eng2 = RapidOCR(det_limit_type='max', det_limit_side_len=960)
    run('dpi200', eng2, variants['dpi200'])
    run('native', eng2, variants['native'])

    print('--- det limit max 1280 ---')
    eng3 = RapidOCR(det_limit_type='max', det_limit_side_len=1280)
    run('dpi200', eng3, variants['dpi200'])
    run('native', eng3, variants['native'])
