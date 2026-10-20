"""验证：列边界用「排除宽 span 后的空白投影」，行用「簇中心聚类」。"""
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
import pymupdf
from extract import _cluster, _group_lines, _spans_of, _table_bands


def column_edges(spans, min_gap=10, wide_ratio=2.5):
    widths = sorted(s['bbox'][2] - s['bbox'][0] for s in spans)
    med = widths[len(widths) // 2]
    narrow = [s for s in spans if (s['bbox'][2] - s['bbox'][0]) <= med * wide_ratio]
    basis = narrow or spans
    lo = int(min(s['bbox'][0] for s in spans)) - 1
    hi = int(max(s['bbox'][2] for s in spans)) + 2
    cover = bytearray(hi - lo)
    for s in basis:
        for x in range(max(0, int(s['bbox'][0]) - lo), min(len(cover), int(s['bbox'][2]) - lo + 1)):
            cover[x] = 1
    edges, start = [], None
    prev = lo
    for i, v in enumerate(cover):
        if not v:
            if start is None:
                start = i
        else:
            if start is not None and i - start >= min_gap:
                edges.append((prev + lo - 0, start + lo))
                prev = i + lo
            start = None
    edges.append((prev, hi))
    return edges, len(basis), len(spans)


doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')
page = doc[50]
lines = _group_lines(_spans_of(page))
for a, b in _table_bands(lines):
    region = [s for ln in lines[a : b + 1] for s in ln]
    edges, nb, nt = column_edges(region)
    # 行：簇中心
    heights = sorted(s['bbox'][3] - s['bbox'][1] for s in region)
    tol = min(max(heights[len(heights) // 2] * 0.4, 4.0), 20.0)
    rowgroups, ordering = [], []
    for s in sorted(region, key=lambda s: s['y']):
        if rowgroups:
            center = sum(m['y'] for m in rowgroups[-1]) / len(rowgroups[-1])
            if abs(s['y'] - center) <= tol:
                rowgroups[-1].append(s)
                continue
        rowgroups.append([s])
    print(f'\nband {a}..{b}: cols={len(edges)} rows={len(rowgroups)} (narrow {nb}/{nt})')
    for rg in rowgroups:
        row = []
        for lo, hi in edges:
            cells = [s['text'] for s in rg if lo <= (s['bbox'][0] + s['bbox'][2]) / 2 < hi]
            row.append(''.join(cells))
        print('   ', ' | '.join((c or '·').ljust(3) for c in row))
