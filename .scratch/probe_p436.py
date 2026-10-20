"""检查 p436（PDF 458）的表格块为什么 rows 为空。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
import pymupdf
from extract import _chars_within, _group_lines, _reconstruct_table, _spans_of, _table_bands, extract_page

doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')
pi = 436 + 22
page = doc[pi]
lines = _group_lines(_spans_of(page))
bands = _table_bands(lines)
print(f'PDF {pi}: spans={len(_spans_of(page))} lines={len(lines)} bands={bands}')
for a, b in bands:
    region = [s for ln in lines[a : b + 1] for s in ln]
    chars = _chars_within(page, region)
    print(f'  band {a}..{b}: spans={len(region)} chars={len(chars)}')
    for ln in lines[a : b + 1]:
        print('     ', repr(''.join(s['text'] for s in ln)[:70]))
    recon = _reconstruct_table(region, page)
    print(f'  recon = {None if recon is None else (len(recon[0]), len(recon[0][0]), round(recon[1], 2))}')
