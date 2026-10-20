"""探针：图注判据里的句读黑名单到底误伤了多少真图注。

`_looks_like_caption` 现在只要出现 `，。、；：！？` 里任意一个就否决。
但图注经常用顿号并列：`图4.4.4 …的逻辑图、逻辑符号和引脚图`。
这里统计全书以「图X.Y」开头的行，按标点分类，看放宽到只否决
`。；！？` 会不会把正文放进来。
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, 'tools/ingest')

import pymupdf
from extract import _group_lines, _spans_of

PDF = '资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf'
doc = pymupdf.open(PDF)

PROSE = ('所示', '如图', '见图', '参见')
START = re.compile(r'^图\s*\d+(?:[.\-]\d+)*\s{1,4}[A-Za-z\u4e00-\u9fff]')

current_ok, relaxed_only, both_reject = [], [], []
for pno in range(24, doc.page_count):
    for ln in _group_lines(_spans_of(doc[pno])):
        t = ''.join(s['text'] for s in ln).strip()
        if not START.match(t) or len(t) > 60:
            continue
        if any(w in t for w in PROSE):
            both_reject.append((pno, t))
            continue
        has_hard = any(ch in t for ch in '。；！？')
        has_soft = any(ch in t for ch in '，、：')
        if has_hard:
            both_reject.append((pno, t))
        elif has_soft:
            relaxed_only.append((pno, t))
        else:
            current_ok.append((pno, t))

print(f'现行判据接受：{len(current_ok)} 条')
print(f'只因「，、：」被拒（放宽后会被接受）：{len(relaxed_only)} 条')
print(f'两边都拒（有硬句读或正文措辞）：{len(both_reject)} 条')
print()
print('--- 放宽后会新增接受的，全列（要人眼确认这些确实是图注）---')
for pno, t in relaxed_only:
    print(f'  p.{pno - 22:>3} {t[:78]}')
print()
print('--- 两边都拒的前 12 条（确认没有误伤）---')
for pno, t in both_reject[:12]:
    print(f'  p.{pno - 22:>3} {t[:78]}')
