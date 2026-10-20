"""探针：为什么 PDF 177 页的 table 块 text 长度是 0。"""
import sys

sys.path.insert(0, 'tools/ingest')

import pymupdf
from extract import _group_lines, _reconstruct_table, _spans_of, _table_bands

PDF = '资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf'
doc = pymupdf.open(PDF)

for pdf_page in [int(a) for a in sys.argv[1:]]:
    page = doc[pdf_page]
    lines = _group_lines(_spans_of(page))
    bands = _table_bands(lines)
    print(f'\n===== PDF {pdf_page} 表格带 {bands} =====')
    for bi, (a, b) in enumerate(bands):
        region = [s for ln in lines[a : b + 1] for s in ln]
        print(f'  带 {bi}: 行 {a}..{b}, {len(region)} 个 span')
        print(f'    原文: {"".join(s["text"] for s in region)[:100]}')
        recon = _reconstruct_table(region, page)
        if recon is None:
            print('    还原 -> None')
        else:
            rows, fill = recon
            print(f'    还原 -> {len(rows)} 行, fill={fill}')
            for r in rows[:4]:
                print(f'      {r}')
