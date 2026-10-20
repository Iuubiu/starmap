"""探测：第 442 页的行结构，找图注位置与图区域边界。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
import pymupdf
from extract import _group_lines, _spans_of

doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')
page = doc[442]
print('页面尺寸', page.rect)
for i, ln in enumerate(_group_lines(_spans_of(page))):
    text = ''.join(s['text'] for s in ln)
    y0 = min(s['bbox'][1] for s in ln)
    y1 = max(s['bbox'][3] for s in ln)
    x0 = min(s['bbox'][0] for s in ln)
    x1 = max(s['bbox'][2] for s in ln)
    print(f'{i:2d} y={y0:6.0f}..{y1:6.0f} x={x0:5.0f}..{x1:5.0f} {text[:56]!r}')

# 图注候选
print('\n图注行:')
for ln in _group_lines(_spans_of(page)):
    t = ''.join(s['text'] for s in ln)
    if t.strip().startswith('图'):
        print('  ', repr(t))
