import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import pymupdf

B = r"D:\DeepSeek\starmap\资源库\books"
samples = {
    "05_汤彬": (B + r"\05_核辐射测量原理_汤彬_哈工程.pdf", [60, 120]),
    "06_陈伯显": (B + r"\06_核辐射物理及探测学_陈伯显_张智_哈工程2011.pdf", [60, 120]),
    "21_康华光数字": (B + r"\21_电子技术基础_数字部分_康华光_第5版.pdf", [50, 150]),
    "26_郭江": (B + r"\26_原子及原子核物理_郭江_第2版_2023.pdf", [50, 150]),
    "01_王芝英SCAN": (B + r"\01_核电子技术原理_王芝英_原子能1989.pdf", [50]),
    "23_阎石SCAN": (B + r"\23_数字电子技术基础_阎石_第6版.pdf", [50]),
}

for name, (p, pages) in samples.items():
    doc = pymupdf.open(p)
    print("=" * 70)
    print(name, "pages=", doc.page_count)
    for i in pages:
        if i >= doc.page_count:
            continue
        t = doc[i].get_text()
        imgs = doc[i].get_images(full=True)
        print(f"--- p{i}  textlen={len(t)}  images={len(imgs)} ---")
        print(t[:600].replace("\n", " / "))
    doc.close()
    print()
