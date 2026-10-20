"""量化：图区域吞进来的行里，有多少是正文（而不是图内碎字）。

判据候选只能是「这行看起来像中文正文」。先把行样本按几个可测特征打过标签，
再决定用哪条阈值，不要凭直觉改。
"""
import sys
sys.path.insert(0, 'tools/ingest')
import pymupdf
import extract as E

CJK = lambda t: sum(1 for ch in t if '\u4e00' <= ch <= '\u9fff')
PUNCT_FULL = '，。、；：！？'
PUNCT_ASCII = ',;:!?'
WS = ' \t'

doc = pymupdf.open('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf')

rows = []
for pi in range(24, 559):
    page = doc[pi]
    lines = E._group_lines(E._spans_of(page))
    if not lines:
        continue
    body = E._page_body_edges(lines)
    caps = {i for i, ln in enumerate(lines) if E._is_caption_line(ln, body)}
    for a, b, _clip in E._figure_regions(lines, page, set()):
        if b < a:
            continue
        for j in range(a, b + 1):
            t = ''.join(s['text'] for s in lines[j]).strip()
            dense = t.replace(' ', '')
            width = max(s['bbox'][2] for s in lines[j]) - min(s['bbox'][0] for s in lines[j])
            rows.append({
                'page': pi - 22,
                'text': t,
                'len': len(dense),
                'cjk': CJK(t),
                'full': any(ch in t for ch in PUNCT_FULL),
                'ascii': any(ch in t for ch in PUNCT_ASCII),
                'width': round(width, 1),
            })

print('图区域吞掉的行总数', len(rows))
susp = [r for r in rows if r['cjk'] >= 6]
print('其中含 >=6 个汉字（疑似正文）', len(susp))
for r in susp[:25]:
    print('p%-4d cjk=%-3d len=%-4d full=%d ascii=%d w=%-7.1f %r'
          % (r['page'], r['cjk'], r['len'], r['full'], r['ascii'], r['width'], r['text'][:60]))

print()
for th in (4, 6, 8, 10):
    hit = [r for r in rows if r['cjk'] >= th and not r['full']]
    print('阈值 cjk>=%d 且无全角句读 → %d 行' % (th, len(hit)))
print()
# 有全角句读但仍含大量汉字的（当前判据会在下一行就停，但它们本身已被吞）
for r in [r for r in rows if r['full'] and r['cjk'] >= 6][:10]:
    print('FULL p%-4d cjk=%-3d %r' % (r['page'], r['cjk'], r['text'][:60]))
