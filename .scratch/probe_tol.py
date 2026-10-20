"""诊断：表格行被拆成两个 line，是因为 y 容差 6 太小。
测量行高与同一表行内的 y 差异，给出有依据的容差。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
import pymupdf
from extract import _spans_of

doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')
page = doc[50]
spans = _spans_of(page)

heights = sorted(s['bbox'][3] - s['bbox'][1] for s in spans)
print('span heights: min=%.1f p25=%.1f median=%.1f p75=%.1f max=%.1f'
      % (heights[0], heights[len(heights) // 4], heights[len(heights) // 2],
         heights[3 * len(heights) // 4], heights[-1]))

# 只看格雷码表区域（y 在 200..700）
tbl = [s for s in spans if 200 < s['y'] < 700]
ys = sorted({round(s['y'], 1) for s in tbl})
print('\nunique y in table region:', len(ys))
print(ys)
gaps = [round(b - a, 1) for a, b in zip(ys, ys[1:])]
print('consecutive y gaps:', gaps)

print('\n同一视觉行内的 y 分布（按 x 排序的 0/1 数字格）:')
row = sorted([s for s in tbl if abs(s['y'] - 350) < 40], key=lambda s: s['x'])
for s in row[:20]:
    print('  y=%7.2f  h=%5.2f  %r' % (s['y'], s['bbox'][3] - s['bbox'][1], s['text']))
