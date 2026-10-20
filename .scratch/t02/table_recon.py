import pymupdf, io, statistics
d = pymupdf.open("资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf")
page = d[50]

# 1. 收集全部 span，只要单字符/短数字（表格单元格）
spans = []
for b in page.get_text("dict")["blocks"]:
    if b.get("type") != 0: continue
    for line in b.get("lines", []):
        for s in line["spans"]:
            x0,y0,x1,y1 = s["bbox"]
            spans.append({"x":(x0+x1)/2, "y":(y0+y1)/2, "t":s["text"].strip()})

# 2. 只看表格区域 y 250..700（从上面 dump 看表头在 191..270）
tbl = [s for s in spans if 250 <= s["y"] <= 700 and s["t"]]
print("cells in region:", len(tbl))

# 3. x 聚类
xs = sorted(s["x"] for s in tbl)
clusters = []
for x in xs:
    if clusters and x - clusters[-1][-1] <= 12:
        clusters[-1].append(x)
    else:
        clusters.append([x])
centers = [statistics.mean(c) for c in clusters]
print("x clusters:", len(centers), [round(c) for c in centers])

# 4. y 聚类成行
ys = sorted(s["y"] for s in tbl)
rows = []
for y in ys:
    if rows and y - rows[-1][-1] <= 10:
        rows[-1].append(y)
    else:
        rows.append([y])
print("rows:", len(rows))

# 5. 铺网格
def col_of(x):
    return min(range(len(centers)), key=lambda i: abs(centers[i]-x))
grid = {}
for s in tbl:
    r = max(i for i,rr in enumerate(rows) if rr[0] <= s["y"] + 10**-6) if any(rr[0] <= s["y"] for rr in rows) else 0
    grid.setdefault(r, {})[col_of(s["x"])] = s["t"]
with io.open(".scratch/t02/grid50.txt","w",encoding="utf-8") as f:
    for r in sorted(grid):
        f.write(f"r{r}: " + " | ".join(grid[r].get(c,"·") for c in range(len(centers))) + "\n")
print("wrote grid")
