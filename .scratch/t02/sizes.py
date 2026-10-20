import pymupdf, collections
d = pymupdf.open("资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf")
for idx in (35, 40, 50, 100, 200):
    c = collections.Counter()
    for b in d[idx].get_text("dict")["blocks"]:
        if b.get("type")!=0: continue
        for line in b.get("lines",[]):
            for s in line["spans"]:
                if s["text"].strip(): c[round(s["size"],1)] += len(s["text"])
    print(idx, "top sizes:", c.most_common(5))
