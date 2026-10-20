import pymupdf, re
d = pymupdf.open("资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf")
for i in range(23, 200):
    t = d[i].get_text()
    m = re.search(r"^\s*(1\.2)\s*数制", t, re.M)
    if m:
        print("found 1.2 数制 at pdf index", i, "-> offset", i - 13)
        break
# 再看页脚有没有纯数字
for i in (30, 40, 50):
    lines = [l.strip() for l in d[i].get_text().splitlines() if l.strip()]
    print(i, "first3:", lines[:3], "last2:", lines[-2:])
