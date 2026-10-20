import pymupdf, re, io
d = pymupdf.open("资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf")
rows = []
for i in range(20, 60):
    t = d[i].get_text()
    # 页脚/页眉常见形式: 单独一行的数字
    lines = [l.strip() for l in t.splitlines() if l.strip()]
    cands = [l for l in lines[:2] + lines[-2:] if re.fullmatch(r"\d{1,3}", l)]
    rows.append((i, cands, lines[0][:40] if lines else ""))
for r in rows[:16]:
    print(r)
