"""验证：用「空白投影」切列切行，能否精确还原两张表。

原理：表格的列边界处，**所有行**都是空的；行边界处**所有列**都是空的。
用 1px 栅格统计覆盖情况，连续空白段就是分隔符。它不依赖中心聚类，
因此不受上下标、跨列标题影响。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
import pymupdf
from extract import _group_lines, _spans_of, _table_bands


def occupancy_gaps(spans, axis, min_gap):
    lo = min(s['bbox'][axis] for s in spans)
    hi = max(s['bbox'][axis + 2] for s in spans)
    lo_i, hi_i = int(lo) - 1, int(hi) + 2
    cover = bytearray(hi_i - lo_i + 2)
    for s in spans:
        a = int(s['bbox'][axis]) - lo_i
        b = int(s['bbox'][axis + 2]) - lo_i + 1
        for x in range(max(0, a), min(len(cover), b)):
            cover[x] = 1
    gaps, start = [], None
    for i, v in enumerate(cover):
        if not v:
            if start is None:
                start = i
        else:
            if start is not None and i - start >= min_gap:
                gaps.append((start + lo_i, i - 1 + lo_i))
            start = None
    return gaps


def segment(spans, axis, min_gap):
    """返回按边界分好的组：[(lo, hi, [spans...])]。"""
    gaps = occupancy_gaps(spans, axis, min_gap)
    edges = []
    cur = min(s['bbox'][axis] for s in spans) - 1
    for a, b in gaps:
        if a > cur:
            edges.append((cur, a))
        cur = b
    edges.append((cur, max(s['bbox'][axis + 2] for s in spans) + 1))
    out = []
    for lo, hi in edges:
        members = [s for s in spans if lo <= (s['bbox'][axis] + s['bbox'][axis + 2]) / 2 < hi]
        if members:
            out.append((lo, hi, members))
    return out


doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')
page = doc[50]
lines = _group_lines(_spans_of(page))
for a, b in _table_bands(lines):
    region = [s for ln in lines[a : b + 1] for s in ln]
    cols = segment(region, 0, min_gap=10)
    rws = segment(region, 1, min_gap=6)
    print(f'\nband {a}..{b}: cols={len(cols)} rows={len(rws)} spans={len(region)}')
    grid = []
    for rlo, rhi, rmembers in rws:
        row = []
        for clo, chi, _ in cols:
            cells = [s['text'] for s in rmembers if clo <= (s['bbox'][0] + s['bbox'][2]) / 2 < chi]
            row.append(''.join(cells))
        grid.append(row)
    for r in grid:
        print('   ', ' | '.join((c or '·').ljust(3) for c in r))
