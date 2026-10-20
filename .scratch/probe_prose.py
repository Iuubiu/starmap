"""图区域吞进来的「含汉字」行：正文 vs 图内标签，能不能用版式分开。

p96 的 `=0.9 V,该电压作用于T,的集电结和` 是正文（左栏），
p78 的 `工作点负载曲线工作点` 是图内标签。两者汉字数都不少，
唯一可能的区分是「贴不贴正文左沿」。
"""
import sys
sys.path.insert(0, 'tools/ingest')
import pymupdf
import extract as E

CJK = lambda t: sum(1 for ch in t if '\u4e00' <= ch <= '\u9fff')
doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')

rows = []
for pi in range(24, 559):
    page = doc[pi]
    lines = E._group_lines(E._spans_of(page))
    if not lines:
        continue
    body = E._page_body_edges(lines)
    if body is None:
        continue
    left, right = body
    for a, b, clip in E._figure_regions(lines, page, set()):
        if b < a:
            continue
        for j in range(a, b + 1):
            ln = lines[j]
            t = ''.join(s['text'] for s in ln).strip()
            if CJK(t) < 4:
                continue
            x0 = min(s['bbox'][0] for s in ln)
            x1 = max(s['bbox'][2] for s in ln)
            rows.append({
                'page': pi - 22,
                'indent': round(x0 - left, 1),
                'r': round((x1 - x0) / (right - left), 2),
                'cjk': CJK(t),
                'len': len(t),
                'text': t,
            })

print('含 >=4 汉字的行', len(rows))
print()
print('== 按缩进排序（贴左沿的都列出来）==')
for r in sorted(rows, key=lambda r: r['indent'])[:45]:
    print('p%-4d indent=%-7.1f r=%-5s cjk=%-3d len=%-4d %r'
          % (r['page'], r['indent'], r['r'], r['cjk'], r['len'], r['text'][:58]))

print()
for th in (10, 20, 30, 40, 60):
    sel = [r for r in rows if r['indent'] <= th]
    print('indent<=%-3d → %-4d 行' % (th, len(sel)))
