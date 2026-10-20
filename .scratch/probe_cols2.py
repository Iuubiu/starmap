"""验证：排除跨列标题（bbox 宽于单格 3 倍）后，格雷码表能否还原成 10x16。"""
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


def reconstruct(region, width_ratio=3.0):
    widths = sorted(s['bbox'][2] - s['bbox'][0] for s in region)
    med_w = widths[len(widths) // 2]
    narrow = [s for s in region if (s['bbox'][2] - s['bbox'][0]) <= med_w * width_ratio]
    wide = [s for s in region if (s['bbox'][2] - s['bbox'][0]) > med_w * width_ratio]

    xs = _cluster([s['x'] for s in narrow], tolerance=12)
    ys = _cluster([s['y'] for s in region], tolerance=10)
    cx = [statistics.mean(c) for c in xs]
    cy = [statistics.mean(c) for c in ys]

    def near(centers, v):
        return min(range(len(centers)), key=lambda i: abs(centers[i] - v))

    grid = {}
    for s in region:
        key = (near(cy, s['y']), near(cx, s['x']))
        grid[key] = (grid[key] + s['text']) if key in grid else s['text']
    fill = len(grid) / (len(ys) * len(xs))
    rows = [[grid.get((r, c), '') for c in range(len(xs))] for r in range(len(ys))]
    return len(xs), len(ys), fill, med_w, [s['text'] for s in wide], rows


for a, b in bands:
    region = [s for ln in lines[a : b + 1] for s in ln]
    cols, rws, fill, med_w, wide, grid = reconstruct(region)
    print(f'band {a}..{b}: cols={cols} rows={rws} fill={fill:.3f} med_w={med_w:.0f} wide={wide}')

a, b = bands[0]
region = [s for ln in lines[a : b + 1] for s in ln]
cols, rws, fill, med_w, wide, grid = reconstruct(region)
print(f'\nnarrow 定列后: cols={cols} rows={rws} fill={fill:.3f}')
for r in grid:
    print('   ', ' | '.join((c or '·').ljust(2) for c in r))
