"""探测：第 442 页（印刷 420）的电路图在 PDF 里是什么形态。

如果是嵌入位图 → get_image_info 有；如果是矢量绘制 → get_drawings 有；
两者都没有说明图被压进了文字层外的背景图。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
import pymupdf

doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')
for pi in (442, 50, 154):
    page = doc[pi]
    imgs = page.get_image_info()
    draws = page.get_drawings()
    print(f'\nPDF {pi}: 位图 {len(imgs)} 个, 矢量绘制 {len(draws)} 个')
    for im in imgs[:5]:
        print(f'   img bbox={tuple(round(v) for v in im["bbox"])} {im.get("width")}x{im.get("height")} {im.get("colorspace")}')
    if draws:
        # 绘制区域的合并范围
        xs0 = [d['rect'].x0 for d in draws]
        ys0 = [d['rect'].y0 for d in draws]
        xs1 = [d['rect'].x1 for d in draws]
        ys1 = [d['rect'].y1 for d in draws]
        print(f'   draw 合并 bbox=({min(xs0):.0f},{min(ys0):.0f},{max(xs1):.0f},{max(ys1):.0f})')
        for d in draws[:5]:
            print(f'      {d["type"]} rect={tuple(round(v) for v in d["rect"])}')
