"""验证：逐行切格（行内按大间距切，跨行不强制对齐）。"""
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
                        out.append({'c': c['c'], 'x0': x0, 'x1': x1, 'y': yc})
    return out


def split_row(chars, gap_factor=1.6):
    cs = sorted(chars, key=lambda c: c['x0'])
    widths = sorted(c['x1'] - c['x0'] for c in cs)
    med = widths[len(widths) // 2] or 10
    cells, cur = [], [cs[0]]
    for prev, nxt in zip(cs, cs[1:]):
        if nxt['x0'] - prev['x1'] > med * gap_factor:
            cells.append(''.join(c['c'] for c in cur))
            cur = [nxt]
        else:
            cur.append(nxt)
    cells.append(''.join(c['c'] for c in cur))
    return cells


def build(region, y_tol=20):
    cs = chars_in(region)
    groups = []
    for c in sorted(cs, key=lambda c: c['y']):
        if groups:
            center = statistics.mean(m['y'] for m in groups[-1])
            if abs(c['y'] - center) <= y_tol:
                groups[-1].append(c)
                continue
        groups.append([c])
    return [split_row(g) for g in groups]


lines = _group_lines(_spans_of(page))
for a, b in _table_bands(lines):
    region = [s for ln in lines[a : b + 1] for s in ln]
    rows = build(region)
    print(f'\nband {a}..{b}: {len(rows)} 行')
    for r in rows:
        print('   ', ' | '.join((c or '·').ljust(4) for c in r))
