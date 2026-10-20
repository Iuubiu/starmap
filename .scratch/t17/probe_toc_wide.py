"""对 toc_probe 没找到目录的书，扫更宽的页范围找目录页。"""
import json
import re
import sys

import pymupdf

sys.path.insert(0, 'tools/ingest')
from ocr import OcrEngine, render_page

TARGETS = [
    ('06-nuclear-radiation-physics-chenboxian', '资源库/books/06_核辐射物理及探测学_陈伯显_张智_哈工程2011.pdf'),
    ('18-nuclear-physics-experiment-methods-1997', '资源库/books/18_原子核物理实验方法_修订第3版_1997.pdf'),
    ('19-radiation-detector-handbook-jichangsong-1990', '资源库/books/19_核辐射探测器及其实验技术手册_汲长松_1990.pdf'),
]

eng = OcrEngine()
out = {}
for sid, pdf in TARGETS:
    doc = pymupdf.open(pdf)
    hits = []
    for i in range(1, min(45, doc.page_count)):
        img = render_page(doc, i, 110)
        lines = eng.lines(img)
        txt = ''.join(l.text for l in lines)
        nums = sum(
            1
            for l in lines
            if re.fullmatch(r'[\s.·•●\-—–+*⋯…]*\d{1,4}[\s.·•●]*', l.text.strip())
            and l.x1 > img.shape[1] * 0.7
        )
        score = 0
        if re.search(r'目\s*录', txt):
            score += 3
        if nums >= 5:
            score += 2
        if txt.count('…') + txt.count('⋯') >= 3:
            score += 1
        if score >= 2:
            hits.append((i, score, len(lines), nums, txt[:40]))
    out[sid] = hits
    print(sid, doc.page_count, flush=True)
    for h in hits:
        print('   ', h, flush=True)
