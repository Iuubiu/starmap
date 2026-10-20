"""给目录页范围不明确的书做逐页细探：看每页前 60 字的开头，人工判定范围。"""
import re
import sys

import pymupdf

sys.path.insert(0, 'tools/ingest')
from ocr import OcrEngine, render_page

TARGETS = [
    ('02', '资源库/books/02_核电子学_王经瑾上_原子能1983.pdf', 5, 14),
    ('05', '资源库/books/05_核辐射测量原理_汤彬_哈工程.pdf', 7, 15),
    ('22', '资源库/books/22_电子技术基础_模拟部分_康华光_第5版.pdf', 8, 24),
    ('25', '资源库/books/25_电路分析基础_李瀚荪_第5版_上册.pdf', 6, 20),
]

eng = OcrEngine()
for sid, pdf, a, b in TARGETS:
    doc = pymupdf.open(pdf)
    print(f'=== {sid} {doc.page_count}p ===', flush=True)
    for i in range(a, min(b, doc.page_count)):
        img = render_page(doc, i, 120)
        lines = eng.lines(img)
        txt = ''.join(l.text for l in lines)
        nums = sum(
            1
            for l in lines
            if re.fullmatch(r'[\s.·•●\-—–+*⋯…]*\d{1,4}[\s.·•●]*', l.text.strip())
            and l.x1 > img.shape[1] * 0.7
        )
        dots = txt.count('…') + txt.count('⋯')
        print(f'  p{i:3d} lines={len(lines):3d} nums={nums:3d} dots={dots:3d} {txt[:56]!r}', flush=True)
