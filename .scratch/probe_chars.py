"""诊断：PDF 文本层是否按字符给出包围盒（rawdict），能否用它逐格对齐真值表。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
import pymupdf

doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')
page = doc[50]
d = page.get_text('rawdict')

nspan = nchar = 0
for b in d['blocks']:
    if b.get('type') != 0:
        continue
    for line in b.get('lines', []):
        for s in line['spans']:
            nspan += 1
            nchar += len(s.get('chars', []))
print(f'spans={nspan} chars={nchar}')

# 取表格区域里一个长 span 看它的字符级 bbox
for b in d['blocks']:
    if b.get('type') != 0:
        continue
    for line in b.get('lines', []):
        for s in line['spans']:
            t = ''.join(c['c'] for c in s.get('chars', []))
            if 200 < s['bbox'][1] < 260 and len(t) >= 14:
                print(f'\nspan text={t!r} bbox={tuple(round(v) for v in s["bbox"])}')
                for c in s['chars'][:18]:
                    x0, y0, x1, y1 = c['bbox']
                    print(f'   {c["c"]!r} x0={x0:7.1f} xc={(x0 + x1) / 2:7.1f} yc={(y0 + y1) / 2:7.1f}')
                raise SystemExit
