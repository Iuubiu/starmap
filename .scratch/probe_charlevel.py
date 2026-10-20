"""验证：用字符级 bbox（rawdict）还原表格，能否精确重建格雷码表与 ASCII 表。"""
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
import pymupdf
from extract import _cluster, _group_lines, _spans_of, _table_bands


def chars_in(page, region):
    """取落在给定 span 区域内的所有字符（带 bbox）。"""
    lo = min(s['bbox'][1] for s in region) - 2
    hi = max(s['bbox'][3] for s in region) + 2
    out = []
    for b in page.get_text('rawdict')['blocks']:
        if b.get('type') != 0:
            continue
        for line in b.get('lines', []):
            for s in line['spans']:
                for c in s.get('chars', []):
                    x0, y0, x1, y1 = c['bbox']
                    yc = (y0 + y1) / 2
                    if lo <= yc <= hi and c['c'].strip():
                        out.append({'c': c['c'], 'x': (x0 + x1) / 2, 'y': yc,
                                    'bbox': (x0, y0, x1, y1)})
    return out


def build(page, region, x_tol=12, y_tol=14):
    cs = chars_in(page, region)
    xs = _cluster([c['x'] for c in cs], tolerance=x_tol)
    ys = _cluster([c['y'] for c in cs], tolerance=y_tol)
    cx = [statistics.mean(c) for c in xs]
    cy = [statistics.mean(c) for c in ys]

    def near(centers, v):
        return min(range(len(centers)), key=lambda i: abs(centers[i] - v))

    grid = {}
    for c in cs:
        key = (near(cy, c['y']), near(cx, c['x']))
        grid[key] = grid.get(key, '') + c['c']
    fill = len(grid) / (len(ys) * len(xs))
    rows = [[grid.get((r, c), '') for c in range(len(xs))] for r in range(len(ys))]
    return len(cs), len(xs), len(ys), fill, rows


doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')
page = doc[50]
lines = _group_lines(_spans_of(page))
for a, b in _table_bands(lines):
    region = [s for ln in lines[a : b + 1] for s in ln]
    nch, cols, rws, fill, grid = build(page, region)
    print(f'\nband {a}..{b}: chars={nch} cols={cols} rows={rws} fill={fill:.3f}')
    for r in grid:
        print('   ', ' | '.join((c or '·').ljust(3) for c in r))
