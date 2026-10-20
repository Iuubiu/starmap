"""验证：只用窄格（≤4 字符）定列中心，能否把格雷码表还原成 8×16。"""
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


def reconstruct(region, narrow_only_cols=True):
    col_src = [s for s in region if len(s['text'].strip()) <= 4] if narrow_only_cols else region
    xs = _cluster([s['x'] for s in col_src], tolerance=12)
    ys = _cluster([s['y'] for s in region], tolerance=10)
    cx = [statistics.mean(c) for c in xs]
    cy = [statistics.mean(c) for c in ys]

    def near(centers, v):
        return min(range(len(centers)), key=lambda i: abs(centers[i] - v))

    grid = {}
    clash = 0
    for s in region:
        key = (near(cy, s['y']), near(cx, s['x']))
        if key in grid:
            clash += 1
            grid[key] = grid[key] + s['text']
        else:
            grid[key] = s['text']
    fill = len(grid) / (len(ys) * len(xs))
    return [len(xs), len(ys), fill, clash, [[grid.get((r, c), '') for c in range(len(xs))] for r in range(len(ys))]]


a, b = bands[0]
region = [s for ln in lines[a : b + 1] for s in ln]
for narrow in (False, True):
    cols, rows, fill, clash, g = reconstruct(region, narrow)
    print(f'narrow_only_cols={narrow}: cols={cols} rows={rows} fill={fill:.3f} clashes={clash}')
    if narrow:
        for r in g:
            print('   ', ' '.join((c or '·').ljust(2) for c in r))
