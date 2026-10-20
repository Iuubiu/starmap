"""探针：找含「图题」或「图3.2.9  0C门」的页面，看它们为什么没变成 figure。"""
import sys

sys.path.insert(0, 'tools/ingest')

import pymupdf
from extract import (
    _figure_regions,
    _group_lines,
    _is_caption_line,
    _page_body_edges,
    _spans_of,
    _table_bands,
    extract_page,
)

PDF = '资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf'
doc = pymupdf.open(PDF)

needles = sys.argv[1:]
for pno in range(24, doc.page_count):
    page = doc[pno]
    lines = _group_lines(_spans_of(page))
    hits = [i for i, ln in enumerate(lines) if any(n in ''.join(s['text'] for s in ln) for n in needles)]
    if not hits:
        continue
    body = _page_body_edges(lines)
    bands = _table_bands(lines)
    blocked = set()
    for a, b in bands:
        blocked |= set(range(a, b + 1))
    regions = _figure_regions(lines, page, blocked)
    print(f'\n===== PDF {pno}（印刷页 {pno - 22}）band={bands} regions={regions} =====')
    for i in hits:
        ln = lines[i]
        t = ''.join(s['text'] for s in ln).strip()
        cap = _is_caption_line(ln, body)
        print(f'  行{i} caption={cap} blocked={i in blocked} | {t[:60]}')
        if body:
            x0 = min(s['bbox'][0] for s in ln)
            x1 = max(s['bbox'][2] for s in ln)
            left, right = body
            print(f'       x0={x0:.0f} x1={x1:.0f} body=({left:.0f},{right:.0f}) '
                  f'居中差={abs((x0-left)-(right-x1)):.0f} 宽比={(x1-x0)/(right-left):.2f}')
    print('  页上块：')
    for b in extract_page(page, pno):
        print(f'    [{b.kind}] {b.text[:60]!r}')
