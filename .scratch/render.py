"""抽样核对：把若干页渲染成图片，并打印同一页抽出来的块。

人工核对的做法是「图片这边看有什么，文本那边找得到对应」。
只跑脚本不看图不算核对。
"""
import io
import json
import sys
from pathlib import Path

import pymupdf

PDF = '资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf'
OUT = Path('.scratch/pdfcheck')
OUT.mkdir(parents=True, exist_ok=True)

# 覆盖不同版面类型的页（PDF 索引）：正文 / 表格 / 公式 / 图 / 演算
PAGES = [int(x) for x in sys.argv[1:]] or [36, 50, 62, 105, 154, 232]

doc = pymupdf.open(PDF)
for i in PAGES:
    page = doc[i]
    pix = page.get_pixmap(dpi=120)
    pix.save(OUT / f'p{i:04d}.png')
    print(f'--- PDF page {i} (印刷页 {i - 22}) -> {OUT / f"p{i:04d}.png"}')
