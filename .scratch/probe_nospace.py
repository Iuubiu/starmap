"""探针：图注在图号后没有空格时，靠什么与正文句子区分？

假设：图注是独立居中行，x0 明显大于正文左边界。
这里对全书以「图X.Y.Z」开头、且图号后无空格的行，
记录它的 x0 与该页正文行 x0 的众数，看能否分开。
"""
import re
import sys
from collections import Counter

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
    # 该页所有长行的 x0 众数 = 正文左边界（取整到 5pt）
    lefts = Counter(round(ln[0]['bbox'][0] / 5) * 5 for ln in lines if len(''.join(s['text'] for s in ln)) > 20)
    body_x0 = lefts.most_common(1)[0][0] if lefts else 0
    for ln in lines:
        t = ''.join(s['text'] for s in ln).strip()
        if NOSPACE.match(t):
            rows.append((pno - 22, round(ln[0]['bbox'][0]), body_x0, t))

print(f'以图号开头但图号后无空格的行：{len(rows)} 条\n')
for p, x0, bx, t in rows[:60]:
    delta = x0 - bx
    print(f'  p.{p:>3} x0={x0:>5} 正文={bx:>5} Δ={delta:>5} {t[:56]}')
