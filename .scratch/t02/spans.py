import pymupdf, io
d = pymupdf.open("资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf")
page = d[50]
dd = page.get_text("dict")
rows = []
for b in dd["blocks"]:
    if b.get("type") != 0: continue
    for line in b.get("lines", []):
        for s in line["spans"]:
            rows.append((round(s["bbox"][1],1), round(s["bbox"][0],1), round(s["bbox"][2],1), s["size"], s["text"]))
rows.sort()
with io.open(".scratch/t02/spans50.txt","w",encoding="utf-8") as f:
    for r in rows: f.write(repr(r)+"\n")
print("spans:", len(rows))
print("y range:", rows[0][0], rows[-1][0])
print("x range:", min(r[1] for r in rows), max(r[2] for r in rows))
