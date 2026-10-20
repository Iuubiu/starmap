"""候选判据：行贴着正文左沿且含汉字 → 是正文，图区域到此为止。

比「含全角句读」可靠，因为 PDF 换行会把句子切断，多数正文行不以句号结尾
（实测 p96 行 18 = `=0.9 V,该电压作用于T,的集电结和`，逗号是半角的）。
"""
import sys
sys.path.insert(0, 'tools/ingest')
import pymupdf
import extract as E

CJK = lambda t: sum(1 for ch in t if '\u4e00' <= ch <= '\u9fff')
doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')

hits = []
for pi in range(24, 559):
    page = doc[pi]
    lines = E._group_lines(E._spans_of(page))
    if not lines:
        continue
    body = E._page_body_edges(lines)
    if body is None:
        continue
    left, right = body
    for a, b, _clip in E._figure_regions(lines, page, set()):
        if b < a:
            continue
        for j in range(a, b + 1):
            ln = lines[j]
            t = ''.join(s['text'] for s in ln).strip()
            if not any('\u4e00' <= ch <= '\u9fff' for ch in t):
                continue
            x0 = min(s['bbox'][0] for s in ln)
            x1 = max(s['bbox'][2] for s in ln)
            indent = x0 - left
            ratio = (x1 - x0) / (right - left)
            full = any(ch in t for ch in '，。、；：！？')
            # 现行判据：含全角句读
            if full:
                continue
            if indent <= 80:
                hits.append((pi - 22, indent, round(ratio, 2), CJK(t), len(t), full, t[:56]))

print('新增会被判为正文的行：', len(hits))
for h in hits[:40]:
    print('p%-4d indent=%-6.1f r=%-5s cjk=%-3d len=%-4d full=%d %r' % h)
