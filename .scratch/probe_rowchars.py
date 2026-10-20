"""逐行统计：字符数、合并后的格数、缺失位置。"""
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
import pymupdf
from extract import _chars_within, _group_lines, _spans_of, _table_bands

doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')
page = doc[50]
lines = _group_lines(_spans_of(page))
a, b = _table_bands(lines)[0]
region = [s for ln in lines[a : b + 1] for s in ln]
chars = _chars_within(page, region)
print(f'区域内字符总数: {len(chars)}')

heights = sorted(c['bbox'][3] - c['bbox'][1] for c in chars)
tol = min(max(heights[len(heights) // 2] * 0.5, 4.0), 24.0)
print(f'字符高度中位数 {heights[len(heights) // 2]:.1f}, 行容差 {tol:.1f}')

groups = []
for c in sorted(chars, key=lambda c: c['y']):
    if groups:
        center = statistics.mean(m['y'] for m in groups[-1])
        if abs(c['y'] - center) <= tol:
            groups[-1].append(c)
            continue
    groups.append([c])

print(f'聚出 {len(groups)} 行')
for gi, g in enumerate(groups):
    ys = [c['y'] for c in g]
    text = ''.join(c['text'] for c in sorted(g, key=lambda c: c['bbox'][0]))
    print(f'  行{gi:2d}: {len(g):3d} 字符 y={min(ys):.1f}..{max(ys):.1f} {text!r}')
