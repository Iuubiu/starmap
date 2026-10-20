"""诊断：_reconstruct_table 在第 50 页的 band 上为什么返回 None。"""
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
import pymupdf
from extract import _cluster, _group_lines, _spans_of, _table_bands

doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')
page = doc[50]
lines = _group_lines(_spans_of(page))
bands = _table_bands(lines)

for a, b in bands:
    region = [s for ln in lines[a : b + 1] for s in ln]
    xs = _cluster([s['x'] for s in region], tolerance=12)
    ys = _cluster([s['y'] for s in region], tolerance=10)
    centers_x = [statistics.mean(c) for c in xs]
    centers_y = [statistics.mean(c) for c in ys]

    def nearest(centers, v):
        return min(range(len(centers)), key=lambda i: abs(centers[i] - v))

    grid = {}
    for s in region:
        key = (nearest(centers_y, s['y']), nearest(centers_x, s['x']))
        grid[key] = (grid[key] + s['text']) if key in grid else s['text']

    fill = len(grid) / (len(ys) * len(xs))
    short = sum(1 for s in region if len(s['text'].strip()) <= 4) / len(region)
    print(f'band {a}..{b}: spans={len(region)} cols={len(xs)} rows={len(ys)} '
          f'grid={len(grid)} fill={fill:.3f} short={short:.3f}')
    print('   x centers:', [round(c) for c in centers_x])
    print('   y centers:', [round(c) for c in centers_y])
