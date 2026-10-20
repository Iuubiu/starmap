"""探针：看泄漏页抽出的 Block 是什么样，据此设计「图碎字」的块级过滤规则。"""
import sys

sys.path.insert(0, 'tools/ingest')

import pymupdf
from extract import extract_page

PDF = '资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf'
doc = pymupdf.open(PDF)

for pdf_page in [int(a) for a in sys.argv[1:]]:
    print(f'\n===== PDF {pdf_page}（印刷页 {pdf_page - 22}）=====')
    for b in extract_page(doc[pdf_page], pdf_page):
        t = b.text.replace('\n', '⏎')
        has_cjk = any('\u4e00' <= ch <= '\u9fff' for ch in b.text)
        print(f'  [{b.kind:9s}] cjk={has_cjk!s:5s} len={len(b.text):4d} clip={b.clip is not None} {t[:70]}')
