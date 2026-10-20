"""验证：只用数据行（短 token 行）定列中心，看格雷码表与 ASCII 表能否精确还原。"""
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
import pymupdf
from extract import _cluster, _group_lines, _spans_of, _table_bands

doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')


def reconstruct(lines, a, b):
    rows_of_lines = lines[a : b + 1]
    # 数据行：行内 ≥4 个 span 且 90% 以上是 ≤2 字符的 token
    data = [ln for ln in rows_of_lines if len(ln) >= 4
            and sum(1 for s in ln if len(s['text'].strip()) <= 2) / len(ln) >= 0.9]
    basis = data or rows_of_lines
    xs = _cluster([s['x'] for ln in basis for s in ln], tolerance=14)
    cx = [statistics.mean(c) for c in xs]
    spans_all = [s for ln in rows_of_lines for s in ln]
    ys = _cluster([s['y'] for s in spans_all], tolerance=10)
    cy = [statistics.mean(c) for c in ys]

    def near(centers, v):
        return min(range(len(centers)), key=lambda i: abs(centers[i] - v))

    grid = {}
    for s in spans_all:
        key = (near(cy, s['y']), near(cx, s['x']))
        grid[key] = (grid[key] + s['text']) if key in grid else s['text']
    fill = len(grid) / (len(ys) * len(xs))
    rows = [[grid.get((r, c), '') for c in range(len(xs))] for r in range(len(ys))]
    return len(data), len(basis), len(xs), len(ys), fill, rows, cx


page = doc[50]
lines = _group_lines(_spans_of(page))
for a, b in _table_bands(lines):
    nd, nb, cols, rws, fill, grid, cx = reconstruct(lines, a, b)
    print(f'\nband {a}..{b}: data_rows={nd}/{b - a + 1} basis={nb} cols={cols} rows={rws} fill={fill:.3f}')
    print('   cx:', [round(c) for c in cx])
    for r in grid:
        print('   ', ' | '.join((c or '·').ljust(3) for c in r))
