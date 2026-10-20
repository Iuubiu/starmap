"""探针：对比图注判据的三套变体，用两个指标衡量。

指标 A：接受多少条以「图X.Y.Z」开头的行（少 = 漏真图注 → 图碎字漏进正文）
指标 B：这些行里有多少条实际是正文（人工抽查名单）
"""
import re
import sys
from pathlib import Path

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
            rows.append((pno - 22, t))

print(f'以图号开头的行共 {len(rows)} 条（未过滤长度）\n')


def rule_current(t):
    return len(t) <= 60 and not any(c in t for c in '，。、；：！？') and not any(
        w in t for w in ('所示', '如图', '见图', '参见')
    )


def rule_relaxed(t):
    """放宽标点：只拒硬句读（。；！？），允许并列顿号与逗号；仍拒正文措辞。"""
    return len(t) <= 60 and not any(c in t for c in '。；！？') and not any(
        w in t for w in ('如图', '见图', '参见')
    )


def rule_nospace(t):
    """在 relaxed 基础上：紧贴图号（无空格）的才算正文。"""
    return rule_relaxed(t) and ' ' in t[:12]


for name, fn in [('现行', rule_current), ('放宽标点', rule_relaxed), ('放宽+要求空格', rule_nospace)]:
    acc = [t for _, t in rows if fn(t)]
    print(f'{name}: 接受 {len(acc)} 条')

print('\n--- 现行拒绝、放宽后接受（逐条人验）---')
for p, t in rows:
    if not rule_current(t) and rule_relaxed(t):
        print(f'  p.{p:>3} {t[:82]}')

print('\n--- 现行拒绝、放宽+空格 仍拒（确认是正文）---')
for p, t in rows:
    if not rule_current(t) and not rule_nospace(t):
        print(f'  p.{p:>3} {t[:82]}')
