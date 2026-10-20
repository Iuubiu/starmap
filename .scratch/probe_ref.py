"""验证：以「格子最多的那一行」为列基准（用列区间而非列中心），其余行按区间归位。"""
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
import pymupdf
from extract import _chars_within, _group_lines, _split_row_cells, _spans_of, _table_bands

doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')
page = doc[50]


def rows_with_cells(chars, y_tol=20):
    groups = []
    for c in sorted(chars, key=lambda c: c['y']):
        if groups:
            center = statistics.mean(m['y'] for m in groups[-1])
            if abs(c['y'] - center) <= y_tol:
                groups[-1].append(c)
                continue
        groups.append([c])

    out = []
    for g in groups:
        cs = sorted(g, key=lambda c: c['bbox'][0])
        widths = sorted(c['bbox'][2] - c['bbox'][0] for c in cs)
        med = widths[len(widths) // 2] or 10.0
        gap = med * 1.6
        cells, cur = [], [cs[0]]
        for prev, nxt in zip(cs, cs[1:]):
            if nxt['bbox'][0] - prev['bbox'][2] > gap:
                cells.append(cur)
                cur = [nxt]
            else:
                cur.append(nxt)
        cells.append(cur)
        out.append(cells)
    return out


def align(rows):
    ref = max(rows, key=len)
    bounds = []
    centers = []
    for cs in ref:
        x0 = min(c['bbox'][0] for c in cs)
        x1 = max(c['bbox'][2] for c in cs)
        centers.append((x0 + x1) / 2)
    edges = [(a + b) / 2 for a, b in zip(centers, centers[1:])]
    bounds = [-1e9] + edges + [1e9]

    grid = []
    for cells in rows:
        row = [''] * len(ref)
        for cs in cells:
            x0 = min(c['bbox'][0] for c in cs)
            x1 = max(c['bbox'][2] for c in cs)
            xc = (x0 + x1) / 2
            idx = next((i for i in range(len(ref)) if bounds[i] <= xc < bounds[i + 1]), None)
            if idx is not None:
                row[idx] += ''.join(c['text'] for c in cs)
            else:
                row[-1] += ''.join(c['text'] for c in cs)
        grid.append(row)
    return grid, len(ref)


lines = _group_lines(_spans_of(page))
for a, b in _table_bands(lines):
    region = [s for ln in lines[a : b + 1] for s in ln]
    rows = rows_with_cells(_chars_within(page, region))
    grid, ncol = align(rows)
    print(f'\nband {a}..{b}: {len(grid)} 行 × {ncol} 列')
    for r in grid:
        print('   ', ' | '.join((c or '·').ljust(4) for c in r))
