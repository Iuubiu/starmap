import pymupdf, io
d = pymupdf.open("资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf")
page = d[50]
tabs = page.find_tables(strategy="text")
t = tabs.tables[0]
rows = t.extract()
with io.open(".scratch/t02/table50b.txt", "w", encoding="utf-8") as f:
    for row in rows:
        f.write(" | ".join("" if c is None else c.replace("\n","") for c in row) + "\n")
print("rows", len(rows), "cols", len(rows[0]))
