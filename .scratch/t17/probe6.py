"""Probe 6: what is the native resolution of the scans, and what det config wins?

RapidOCR's default det config is limit_type='min', limit_side_len=736. On a 200-dpi
render (2423x1740) min=1740 >= 736, so ratio=1.0 -> the detector runs on the FULL
page, which is why det alone costs 1.5 s. limit_type='max' would downscale instead.
"""
import sys
import time

import numpy as np
import pymupdf

SITE = 'C:/Users/Yhwhy/scoop/apps/python/current/Lib/site-packages/rapidocr_onnxruntime/'
sys.path.insert(0, SITE)

BOOK = '资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf'

doc = pymupdf.open(BOOK)
print('pages', doc.page_count)
for i in (0, 1, 3, 20, 50, 60, 120):
    p = doc[i]
    imgs = p.get_images(full=True)
    info = p.get_image_info()
    print(f'p{i}: rect={tuple(round(v) for v in p.rect)} imgs={len(imgs)}')
    for im in imgs:
        xref = im[0]
        d = doc.extract_image(xref)
        print(f'   xref {xref}: {d["width"]}x{d["height"]} ext={d["ext"]} colorspace={d.get("colorspace")} bytes={len(d["image"])}')
    for ii in info:
        print('   info bbox', tuple(round(v) for v in ii['bbox']), 'size', ii['width'], ii['height'])
