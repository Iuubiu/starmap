"""探针：为什么 PDF 164 页的图碎字漏进了正文。"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, 'tools/ingest')

import pymupdf
from extract import _group_lines, _looks_like_caption, _looks_like_subcaption, _spans_of, _table_bands

PDF = '资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf'
doc = pymupdf.open(PDF)
page = doc[164]
lines = _group_lines(_spans_of(page))
bands = _table_bands(lines)
band_lines = set()
for a, b in bands:
    band_lines |= set(range(a, b + 1))

print(f'总行数 {len(lines)}, 表格带 {bands}')
print()
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
    has_punct = any(ch in t for ch in '，。、；：！？')
    if has_cjk and has_punct:
        marks.append('PROSE-STOP')
    tag = ' '.join(marks)
    print(f'{i:3d} y={ln[0]["bbox"][1]:6.0f} {tag:32s} {t[:60]}')
