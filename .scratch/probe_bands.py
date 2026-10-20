"""诊断：第 50 页（印刷页 28）每行为什么被判成/不判成表格行。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
import pymupdf
from extract import _spans_of, _reconstruct_table, _table_bands

doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')
page = doc[50]
spans = _spans_of(page)

lines = []
for s in sorted(spans, key=lambda s: (s['y'], s['x'])):
    if lines and abs(s['y'] - lines[-1][0]['y']) <= 6:
        lines[-1].append(s)
    else:
        lines.append([s])
for line in lines:
    line.sort(key=lambda s: s['x'])

print(f'lines={len(lines)}')
for i, line in enumerate(lines):
    text = ''.join(s['text'] for s in line).strip()
    if len(line) >= 3:
        short = sum(1 for s in line if len(s['text'].strip()) <= 4) / len(line)
        width = max(s['bbox'][2] for s in line) - min(s['bbox'][0] for s in line)
    else:
        short, width = 0.0, 0.0
    flag = len(line) >= 3 and short >= 0.7 and width > 300
    print(f'{i:3d} n={len(line):2d} short={short:.2f} w={width:6.0f} {"BAND" if flag else "    "} {text[:60]!r}')

print()
print('bands:', _table_bands(lines))
for a, b in _table_bands(lines):
    region = [s for ln in lines[a : b + 1] for s in ln]
    rows = _reconstruct_table(region)
    print(f'band {a}..{b}: rows={0 if rows is None else len(rows)}')
