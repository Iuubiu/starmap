"""最后一轮：确认 06/07/23/24/25 的目录结束页（后面的第一页正文）。"""
import re
import sys

import pymupdf

sys.path.insert(0, 'tools/ingest')
from ocr import OcrEngine, render_page

TARGETS = [
    ('06', '资源库/books/06_核辐射物理及探测学_陈伯显_张智_哈工程2011.pdf', 9, 17),
    ('07', '资源库/books/07_核辐射探测器_丁洪林_哈工程2010.pdf', 9, 17),
    ('23', '资源库/books/23_数字电子技术基础_阎石_第6版.pdf', 19, 26),
    ('24', '资源库/books/24_模拟电子技术基础_童诗白_华成英_第5版.pdf', 17, 24),
    ('25', '资源库/books/25_电路分析基础_李瀚荪_第5版_上册.pdf', 7, 20),
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
        print(f'  p{i:3d} lines={len(lines):3d} nums={nums:3d} {txt[:60]!r}', flush=True)
