"""诊断：用新的自适应分行后，第 50 页的表格带与行还原情况。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
import pymupdf
from extract import _group_lines, _reconstruct_table, _spans_of, _table_bands

doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')

for pi in (50, 53, 148):
    page = doc[pi]
    spans = _spans_of(page)
    lines = _group_lines(spans)
    bands = _table_bands(lines)
    print(f'=== PDF page {pi}: spans={len(spans)} lines={len(lines)} bands={len(bands)}')
    for a, b in bands:
        region = [s for ln in lines[a : b + 1] for s in ln]
        rows = _reconstruct_table(region)
        print(f'   band {a}..{b} lines={b - a + 1} spans={len(region)} rows={0 if rows is None else len(rows)}'
              f' cols={0 if rows is None else len(rows[0])}')
    if pi == 50:
        for i, line in enumerate(lines[:16]):
            text = ''.join(s['text'] for s in line).strip()
            print(f'   {i:3d} n={len(line):2d} {text[:64]!r}')
        rows = _reconstruct_table([s for ln in lines[bands[0][0] : bands[0][1] + 1] for s in ln]) if bands else None
        if rows:
            print('\n   格雷码表还原结果:')
            for r in rows:
                print('    ', ' '.join(c or '.' for c in r))
