"""探针：图注是**居中**行，正文是**左对齐/两端对齐**行。

对全书以「图X.Y.Z」开头、图号后无空格的行，量一下它在本页的
「左缩进 − 右缩进」差值。居中行这个差值接近 0；正文行左缩进≈0、
右缩进取决于行长，差值一般明显为负。
"""
import re
import sys

sys.path.insert(0, 'tools/ingest')

import pymupdf
from extract import _group_lines, _spans_of

PDF = '资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf'
doc = pymupdf.open(PDF)
NOSPACE = re.compile(r'^图\s*\d+(?:[.\-]\d+)*[^\s\d]')

rows = []
for pno in range(24, doc.page_count):
    page = doc[pno]
    lines = _group_lines(_spans_of(page))
    if not lines:
        continue
    # 本页正文的左右边界 = 长行 bbox 的众数
    lefts, rights = [], []
    for ln in lines:
        txt = ''.join(s['text'] for s in ln)
        if len(txt) > 30:
            lefts.append(ln[0]['bbox'][0])
            rights.append(max(s['bbox'][2] for s in ln))
    if not lefts:
        continue
    left = min(lefts)
    right = max(rights)
    for ln in lines:
        t = ''.join(s['text'] for s in ln).strip()
        if NOSPACE.match(t):
            x0 = ln[0]['bbox'][0]
            x1 = max(s['bbox'][2] for s in ln)
            rows.append((pno - 22, round(x0 - left), round(right - x1), t))

rows.sort(key=lambda r: abs(r[1] - r[2]))
print(f'共 {len(rows)} 条。按「居中程度」排序（Δ = |左缩进 − 右缩进|）：\n')
for p, gl, gr, t in rows:
    centered = abs(gl - gr) <= 40
    print(f'  p.{p:>3} 左={gl:>4} 右={gr:>4} Δ={abs(gl-gr):>4} {"居中" if centered else "    "} {t[:52]}')
