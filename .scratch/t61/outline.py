"""从 PDF 书签（outline）里找候选碎片的前后条目。扫描件没有文字层，但常有出版社书签。"""
import io
import sys

sys.path.insert(0, 'tools/ingest')
import pymupdf  # noqa: E402

CASES = [
    ('资源库/books/24_模拟电子技术基础_童诗白_华成英_第5版.pdf', ['晶体三极管模型']),
    ('资源库/books/18_原子核物理实验方法_修订第3版_1997.pdf',
     ['带电粒子在靶物质中的慢化', '重带电粒子在物质中的能量损失', '重离子的电子阻止本领',
      '倍增过程统计学', '中子全截面测量', '概述']),
    ('资源库/books/06_核辐射物理及探测学_陈伯显_张智_哈工程2011.pdf', ['中子探测方法和常用探测器']),
    ('资源库/books/19_核辐射探测器及其实验技术手册_汲长松_1990.pdf', ['光导纤维光导', '工作原理']),
    ('资源库/books/07_核辐射探测器_丁洪林_哈工程2010.pdf', ['作用与地位']),
]

out = []
for pdf, needles in CASES:
    doc = pymupdf.open(pdf)
    toc = doc.get_toc(simple=True)
    out.append(f'########## {pdf}  pages={doc.page_count}  outline_entries={len(toc)}')
    titles = [t for _, t, _ in toc]
    for nd in needles:
        idxs = [i for i, t in enumerate(titles) if nd in t]
        out.append(f'--- needle {nd!r} -> outline idx {idxs[:5]}')
        for i in idxs[:2]:
            lo = max(0, i - 3)
            hi = min(len(toc), i + 3)
            for j in range(lo, hi):
                mark = '>>>' if j == i else '   '
                lvl, t, p = toc[j]
                out.append(f'  {mark} [{j}] L{lvl} p{p} {t!r}')
    doc.close()

io.open('.scratch/t61/outline_dump.txt', 'w', encoding='utf-8').write('\n'.join(out))
print('written', len(out), 'lines')
