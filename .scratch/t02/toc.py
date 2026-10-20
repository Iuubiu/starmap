import pymupdf, re, io, sys
p = "资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf"
d = pymupdf.open(p)
out = []
for i in range(14, 24):
    t = d[i].get_text()
    if "目录" in t or re.search(r"^\d+(\.\d+)*\S+⋯", t, re.M):
        out.append((i, t))
with io.open(".scratch/t02/toc_raw.txt", "w", encoding="utf-8") as f:
    for i, t in out:
        f.write(f"\n===== page {i} =====\n{t}")
print("wrote pages:", [i for i,_ in out])
print("total chars:", sum(len(t) for _,t in out))
