"""探针：图注 = 居中 **且** 不满宽；正文 = 两端对齐满宽。

上一步只看「居中」不够 —— 满宽的正文行左缩进与右缩进也接近相等。
加上「行宽 < 正文宽的 70%」这个条件再验证。
"""
import re
import sys

sys.path.insert(0, 'tools/ingest')

import pymupdf
from extract import _group_lines, _spans_of

PDF = '资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf'
doc = pymupdf.open(PDF)
NOSPACE = re.compile(r'^图\s*\d+(?:[.\-]\d+)*[^\s\d]')
PROSE_WORDS = ('所示', '如图', '见图', '参见')

accepted, rejected = [], []
for pno in range(24, doc.page_count):
    page = doc[pno]
    lines = _group_lines(_spans_of(page))
    if not lines:
        continue
    lefts, rights = [], []
    for ln in lines:
        if len(''.join(s['text'] for s in ln)) > 30:
            lefts.append(ln[0]['bbox'][0])
            rights.append(max(s['bbox'][2] for s in ln))
    if not lefts:
        continue
    left, right = min(lefts), max(rights)
    body_w = right - left
    if body_w <= 0:
        continue
    for ln in lines:
        t = ''.join(s['text'] for s in ln).strip()
        if not NOSPACE.match(t) or len(t) > 60:
            continue
        x0 = ln[0]['bbox'][0]
        x1 = max(s['bbox'][2] for s in ln)
        gl, gr, w = x0 - left, right - x1, x1 - x0
        ratio = w / body_w
        # 图注候选：居中(±40) 且 不满宽(<0.75) 且 不含正文措辞
        ok = abs(gl - gr) <= 40 and ratio < 0.75 and not any(wd in t for wd in PROSE_WORDS)
        (accepted if ok else rejected).append((pno - 22, round(ratio, 2), t))

print(f'接受 {len(accepted)} 条（应全是图注）：')
for p, r, t in accepted:
    print(f'  p.{p:>3} w={r} {t[:56]}')
print(f'\n拒绝 {len(rejected)} 条（含正文，抽前 20 条人验）：')
for p, r, t in rejected[:20]:
    print(f'  p.{p:>3} w={r} {t[:56]}')
