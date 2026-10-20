import pymupdf, io
d = pymupdf.open("资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf")
page = d[50]
for strat in ("lines", "lines_strict", "text"):
    try:
        tabs = page.find_tables(strategy=strat)
        print(strat, "->", len(tabs.tables), [(t.row_count, t.col_count) for t in tabs.tables])
    except Exception as e:
        print(strat, "ERR", type(e).__name__, e)
# 检查这一页有没有画线
dr = page.get_drawings()
print("drawings:", len(dr))
