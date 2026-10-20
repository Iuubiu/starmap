import sys; sys.path.insert(0,"tools/ingest")
from extract import extract_page
import pymupdf
d = pymupdf.open("资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf")
for b in extract_page(d[40], 40):
    if b.kind=="heading":
        print(b.kind, b.level, [round(x) for x in b.bbox], repr(b.text[:30]))
