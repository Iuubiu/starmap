"""验证：逐行切格后，用「全表所有格中心聚类」定列，把每行的格按 x 归位。

这一步解决的是「空单元导致右侧格整体左移」：逐行切格保证格内文字正确，
但空着的格不产生字符，因此行内切出的格数少于列数。用格中心的 x 归位后，
空列会被正确留空。
"""
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
import pymupdf
from extract import _cluster, _spans_of, _table_bands, _group_lines, _chars_within, _split_row_cells

doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')
page = doc[50]


def rows_with_cells(chars, y_tol):
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
        cells = []
        cs = sorted(g, key=lambda c: c['bbox'][0])
        widths = sorted(c['bbox'][2] - c['bbox'][0] for c in cs)
        med = widths[len(widths) // 2] or 10.0
        gap = med * 1.6
        cur = [cs[0]]
        for prev, nxt in zip(cs, cs[1:]):
            if nxt['bbox'][0] - prev['bbox'][2] > gap:
                cells.append(cur)
                cur = [nxt]
            else:
                cur.append(nxt)
        cells.append(cur)
        out.append(cells)
    return out


lines = _group_lines(_spans_of(page))
for a, b in _table_bands(lines):
    region = [s for ln in lines[a : b + 1] for s in ln]
    chars = _chars_within(page, region)
    rws = rows_with_cells(chars, 20)

    # 所有格的中心
    centers = []
    for cells in rws:
        for cs in cells:
            x0 = min(c['bbox'][0] for c in cs)
            x1 = max(c['bbox'][2] for c in cs)
            centers.append((x0 + x1) / 2)

    cw = sorted(c['bbox'][2] - c['bbox'][0] for c in chars)
    tol = cw[len(cw) // 2] * 0.8
    cols = _cluster(centers, tolerance=tol)
    cx = [statistics.mean(c) for c in cols]
    print(f'\nband {a}..{b}: {len(rws)} 行, 格中心聚出 {len(cx)} 列 (tol={tol:.1f})')

    def near(v):
        return min(range(len(cx)), key=lambda i: abs(cx[i] - v))

    grid = [[''] * len(cx) for _ in rws]
    for ri, cells in enumerate(rws):
        for cs in cells:
            x0 = min(c['bbox'][0] for c in cs)
            x1 = max(c['bbox'][2] for c in cs)
            grid[ri][near((x0 + x1) / 2)] += ''.join(c['text'] for c in cs)
    for r in grid:
        print('   ', ' | '.join((c or '·').ljust(4) for c in r))
