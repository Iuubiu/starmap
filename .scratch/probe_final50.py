"""核对：第 50 页两张表的最终还原结果 + 该页所有块。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
import pymupdf
from extract import extract_page

doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')
for blk in extract_page(doc[50], 50):
    print(f'[{blk.kind}] rows={len(blk.rows)} fill={blk.fill:.2f} {blk.text[:40]!r}')
    for r in blk.rows:
        print('     ', ' | '.join((c or '·').ljust(4) for c in r))
