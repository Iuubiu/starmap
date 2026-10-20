import pymupdf, io
d = pymupdf.open("资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf")
page = d[50]
tabs = page.find_tables()
print("tables found:", len(tabs.tables))
for t in tabs.tables:
    print("rows x cols:", t.row_count, t.col_count)
    with io.open(".scratch/t02/table50.txt", "w", encoding="utf-8") as f:
        for row in t.extract():
            f.write(" | ".join("" if c is None else c.replace("\n","") for c in row) + "\n")
