"""探针：设计一条「图号后无空格」的图注判据，并列出它会新接受什么。

要覆盖的真实图注形态（都已被实测确认）：
  - `图6.5.6实现多种功能双向移位寄存器的一种方案`（图号与标题之间无空格）
  - `图4.4.21  74HC151的逻辑图`（标题以数字开头）
  - `图题5.3.1`（习题图）
正文句子（要拒绝）：
  - `图1.1.1所示为转换过程中各种波形图，…`
  - `图2.2.5所示的卡诺图可以简化成如图2.2.6所示。`
"""
import re
import sys

sys.path.insert(0, 'tools/ingest')

import pymupdf
from extract import _group_lines, _spans_of

PDF = '资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf'
doc = pymupdf.open(PDF)

NUM = r'\d+(?:[.\-]\d+)*'
SPACED = re.compile(r'^图\s*' + NUM + r'\s{1,4}[A-Za-z0-9\u4e00-\u9fff]')
TITLED = re.compile(r'^图题\s*' + NUM)
NOSPACE = re.compile(r'^图\s*' + NUM + r'(?![\s\d])')
PROSE_WORDS = ('所示', '如图', '见图', '参见')


def accepts(t: str) -> tuple[bool, str]:
    if len(t) > 60:
        return False, 'too-long'
    if SPACED.match(t) or TITLED.match(t):
        return True, 'spaced-or-titled'
    if NOSPACE.match(t) and not any(w in t for w in PROSE_WORDS) and '。' not in t:
        return True, 'nospace-clean'
    return False, 'reject'


newly = []
for pno in range(24, doc.page_count):
    for ln in _group_lines(_spans_of(doc[pno])):
        t = ''.join(s['text'] for s in ln).strip()
        if not t.startswith('图'):
            continue
        ok, why = accepts(t)
        if ok and why == 'nospace-clean':
            newly.append((pno - 22, t))

print(f'「无空格但干净」新增接受：{len(newly)} 条，逐条人验：\n')
for p, t in newly:
    print(f'  p.{p:>3} {t}')
