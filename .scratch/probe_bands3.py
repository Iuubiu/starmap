"""核对：第 50 页格雷码表 / ASCII 表还原成什么，与书上对照。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
import pymupdf
from extract import _group_lines, _reconstruct_table, _spans_of, _table_bands, extract_page

doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')
page = doc[50]
lines = _group_lines(_spans_of(page))
bands = _table_bands(lines)

print(f'bands = {bands}')
for a, b in bands:
    region = [s for ln in lines[a : b + 1] for s in ln]
    grid, fill = _reconstruct_table(region)
    print(f'\n--- band {a}..{b}: {len(grid)} 行 × {len(grid[0])} 列, fill={fill:.3f}')
    for r in grid:
        print('   ', ' | '.join((c or '·').ljust(3) for c in r))

print('\n=== extract_page 出来的块 ===')
for blk in extract_page(page, 50):
    head = blk.text[:60].replace('\n', ' / ')
    print(f'[{blk.kind}] rows={len(blk.rows)} fill={blk.fill:.2f} {head!r}')
