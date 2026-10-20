"""诊断：ASCII 表的列边界在哪里。用字符级 bbox 做「空列投影」。

判据不用中心距离（上下标、跨列标题会把它带偏），而是找**整列都空**的
x 区间当列分隔符。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
import pymupdf

doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')
page = doc[50]
d = page.get_text('rawdict')

# 收 ASCII 表区域（y 1130..1700）的所有字符框
chars = []
for b in d['blocks']:
    if b.get('type') != 0:
        continue
    for line in b.get('lines', []):
        for s in line['spans']:
            for c in s.get('chars', []):
                x0, y0, x1, y1 = c['bbox']
                if 1130 < (y0 + y1) / 2 < 1700:
                    chars.append((x0, x1, (y0 + y1) / 2, c['c']))

print(f'chars in region: {len(chars)}')

# 同一 y 上的字符拼成行，看每行的字符数与 x 跨度
rows = {}
for x0, x1, yc, ch in chars:
    key = round(yc / 20)
    rows.setdefault(key, []).append((x0, x1, ch))
print(f'rows: {len(rows)}')
for k in sorted(rows)[:4]:
    r = sorted(rows[k])
    print(f'  row y~{k * 20}: {len(r)} chars, x {r[0][0]:.0f}..{r[-1][1]:.0f}')
    print('     ', ''.join(c for _, _, c in r))

# 空列投影：把所有字符的 x 区间刷到 1px 的栅格上，找连续空白
import collections

W = 1700
cover = bytearray(W)
for x0, x1, _, _ in chars:
    for x in range(max(0, int(x0)), min(W, int(x1) + 1)):
        cover[x] = 1

gaps = []
start = None
for x in range(W):
    if not cover[x]:
        if start is None:
            start = x
    else:
        if start is not None:
            if x - start >= 8:
                gaps.append((start, x - 1, x - start))
            start = None
print(f'\n空白 x 区间（宽 ≥8px）: {len(gaps)}')
print(gaps)
