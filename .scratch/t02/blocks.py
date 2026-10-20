import pymupdf, io
d = pymupdf.open("资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf")
# 第 50 pdf 页是 格雷码真值表（已知碎裂）
for idx in (35, 50):
    page = d[idx]
    dd = page.get_text("dict")
    with io.open(f".scratch/t02/blocks_{idx}.txt", "w", encoding="utf-8") as f:
        for bi, b in enumerate(dd["blocks"]):
            if b.get("type") != 0: continue
            f.write(f"--- block {bi} bbox={[round(x) for x in b['bbox']]}\n")
            for li, line in enumerate(b.get("lines", [])):
                txt = "".join(s["text"] for s in line["spans"])
                f.write(f"  L{li}: {txt!r}\n")
    print("wrote", idx, "blocks:", len(dd["blocks"]))
