"""p96 行内 span 的 x 分布：图和正文是不是左右并排。"""
import sys
sys.path.insert(0, 'tools/ingest')
import pymupdf
import extract as E

doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')
page = doc[118]
lines = E._group_lines(E._spans_of(page))
body = E._page_body_edges(lines)
print('page rect', page.rect)
print('body edges', body)
for j in range(11, 21):
    print('-- line', j)
    for s in sorted(lines[j], key=lambda s: s['bbox'][0]):
        print('   x0=%-7.1f x1=%-7.1f y=%-7.1f size=%-5.1f %r'
              % (s['bbox'][0], s['bbox'][2], s['bbox'][1], s['size'], s['text'][:40]))
