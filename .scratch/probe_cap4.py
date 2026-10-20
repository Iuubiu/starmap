"""探针：如果完全放开句读限制（只留「图号+空格」与长度上限），
会不会把正文放进来？逐条看 266 条里最长的那些。
"""
import re
import sys

sys.path.insert(0, 'tools/ingest')

import pymupdf
from extract import _group_lines, _spans_of

PDF = '资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf'
doc = pymupdf.open(PDF)
START = re.compile(r'^图\s*\d+(?:[.\-]\d+)*\s{1,4}[A-Za-z\u4e00-\u9fff]')

rows = []
for pno in range(24, doc.page_count):
    for ln in _group_lines(_spans_of(doc[pno])):
        t = ''.join(s['text'] for s in ln).strip()
        if START.match(t):
            rows.append((pno - 22, len(t), t))

rows.sort(key=lambda r: -r[1])
print(f'共 {len(rows)} 条；按长度降序前 25：\n')
for p, n, t in rows[:25]:
    print(f'  p.{p:>3} len={n:>3} {t}')

print('\n长度 > 40 的条数：', sum(1 for _, n, _ in rows if n > 40))
print('含「。」的条数：', sum(1 for _, _, t in rows if '。' in t))
print('含「，」的条数：', sum(1 for _, _, t in rows if '，' in t))
print('含「、」的条数：', sum(1 for _, _, t in rows if '、' in t))
print()
print('--- 含「。」的全部条目（最可能混入正文的）---')
for p, n, t in rows:
    if '。' in t:
        print(f'  p.{p:>3} len={n:>3} {t}')
