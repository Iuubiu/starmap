import sys, io, json
sys.path.insert(0, "tools/ingest")
from extract import extract_page
import pymupdf

d = pymupdf.open("资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf")
for idx in (50, 35, 40):
    blocks = extract_page(d[idx], idx)
    print(f"=== page {idx}: {len(blocks)} blocks")
    for b in blocks[:6]:
        t = b.text[:60] if b.text else f"<table {len(b.rows)}x{len(b.rows[0]) if b.rows else 0}>"
        print(f"  {b.kind:10s} lvl{b.level} {t!r}")
