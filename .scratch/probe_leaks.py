"""探针：剩余泄漏碎片所在页的行结构，找出为什么图区域没把它们吃掉。"""
import sys

sys.path.insert(0, 'tools/ingest')

import pymupdf
from extract import _group_lines, _looks_like_caption, _looks_like_subcaption, _spans_of, _table_bands

PDF = '资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf'
doc = pymupdf.open(PDF)

for pdf_page in [int(a) for a in sys.argv[1:]]:
    page = doc[pdf_page]
    lines = _group_lines(_spans_of(page))
    bands = _table_bands(lines)
    band_lines = set()
    for a, b in bands:
        band_lines |= set(range(a, b + 1))
    print(f'\n===== PDF {pdf_page}（印刷页 {pdf_page - 22}），共 {len(lines)} 行，表格带 {bands} =====')
    for i, ln in enumerate(lines):
        t = ''.join(s['text'] for s in ln).strip()
        marks = []
        if i in band_lines:
            marks.append('BAND')
        if _looks_like_caption(t):
            marks.append('CAPTION')
        if _looks_like_subcaption(t):
            marks.append('SUB')
        has_cjk = any('\u4e00' <= ch <= '\u9fff' for ch in t)
        if has_cjk and any(ch in t for ch in '，。、；：！？'):
            marks.append('PROSE')
        print(f'{i:3d} y={ln[0]["bbox"][1]:6.0f} {" ".join(marks):20s} {t[:58]}')
