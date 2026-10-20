"""诊断：格雷码表区域内所有 span 的 x 中心与高度，看列被什么打乱。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
import pymupdf
from extract import _group_lines, _spans_of, _table_bands

doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')
page = doc[50]
lines = _group_lines(_spans_of(page))
bands = _table_bands(lines)
a, b = bands[0]
region = [s for ln in lines[a : b + 1] for s in ln]

print('每个 span: y中心 / 高 / x中心 / 宽 / 文本')
for s in sorted(region, key=lambda s: (round(s['y']), s['x'])):
    h = s['bbox'][3] - s['bbox'][1]
    w = s['bbox'][2] - s['bbox'][0]
    print(f'  y={s["y"]:7.1f} h={h:5.1f} x={s["x"]:7.1f} w={w:5.1f} {s["text"]!r}')
