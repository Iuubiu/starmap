"""调参：字符级 bbox + 不同 x/y 容差，看哪组参数能把两张表还原对。

关键约束：同一单元格内相邻字符的间距 ≈ 字符宽（实测 ~20px），
相邻单元格的间距 ≈ 70px。容差必须落在两者之间。
"""
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
import pymupdf
from extract import _cluster, _group_lines, _spans_of, _table_bands

doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')
page = doc[50]


def chars_in(region):
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
                        out.append({'c': c['c'], 'x': (x0 + x1) / 2, 'y': yc})
    return out


def build(region, x_tol, y_tol):
    cs = chars_in(region)
    word = _cluster([c['x'] for c in cs], tolerance=x_tol)
    ys = _cluster([c['y'] for c in cs], tolerance=y_tol)
    cx = [statistics.mean(w) for w in word]
    cy = [statistics.mean(w) for w in ys]

    def near(centers, v):
        return min(range(len(centers)), key=lambda i: abs(centers[i] - v))

    grid = {}
    for c in cs:
        grid.setdefault((near(cy, c['y']), near(cx, c['x'])), '')
        grid[(near(cy, c['y']), near(cx, c['x']))] += c['c']
    fill = len(grid) / (len(ys) * len(word))
    rows = [[grid.get((r, c), '') for c in range(len(word))] for r in range(len(ys))]
    return len(word), len(ys), fill, rows


lines = _group_lines(_spans_of(page))
bands = _table_bands(lines)
for xt in (18, 22, 26, 30):
    for yt in (14, 20, 24):
        outs = []
        for a, b in bands:
            region = [s for ln in lines[a : b + 1] for s in ln]
            cols, rws, fill, _ = build(region, xt, yt)
            outs.append(f'({cols}c×{rws}r fill={fill:.2f})')
        print(f'x_tol={xt:2d} y_tol={yt:2d}  ' + '  '.join(outs))

print('\n=== 选定参数下的网格 ===')
for xt, yt in ((26, 20), (30, 20)):
    print(f'\n--- x_tol={xt} y_tol={yt}')
    for a, b in bands:
        region = [s for ln in lines[a : b + 1] for s in ln]
        cols, rws, fill, grid = build(region, xt, yt)
        print(f'band {a}..{b}: {rws} 行 × {cols} 列 fill={fill:.3f}')
        for r in grid:
            print('   ', ' | '.join((c or '·').ljust(4) for c in r))
