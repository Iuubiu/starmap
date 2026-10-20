import pymupdf, json, sys
p = "资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf"
d = pymupdf.open(p)
print("pages:", d.page_count)
# 找目录页
for i in range(0, 20):
    t = d[i].get_text()
    if "目" in t and "录" in t:
        print("=== TOC candidate page", i)
        print(t[:1500])
        break
