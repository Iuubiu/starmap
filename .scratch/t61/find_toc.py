"""定位目录页：按短词扫描，输出 UTF-8 文件避免控制台编码问题。"""
import io
import sys

sys.path.insert(0, 'tools/ingest')
import pymupdf  # noqa: E402

BOOKS = [
    '资源库/books/24_模拟电子技术基础_童诗白_华成英_第5版.pdf',
    '资源库/books/18_原子核物理实验方法_修订第3版_1997.pdf',
    '资源库/books/06_核辐射物理及探测学_陈伯显_张智_哈工程2011.pdf',
    '资源库/books/19_核辐射探测器及其实验技术手册_汲长松_1990.pdf',
    '资源库/books/07_核辐射探测器_丁洪林_哈工程2010.pdf',
]
NEEDLES = ['带电粒子', '晶体三极管', '中子探测方法', '光导纤维', '作用与地位', '目录']

out = []
for pdf in BOOKS:
    doc = pymupdf.open(pdf)
    out.append(f'########## {pdf}  pages={doc.page_count}')
    for nd in NEEDLES:
        found = [i for i in range(min(120, doc.page_count)) if nd in doc[i].get_text()]
        out.append(f'--- {nd!r}: {found[:15]} (n={len(found)})')
    # 前 40 页里含「目录」的页
    for i in range(min(40, doc.page_count)):
        t = doc[i].get_text()
        if '目录' in t:
            out.append(f'  === TOC-ish page index {i} (len={len(t)}) ===')
            for ln in t.splitlines():
                s = ln.strip()
                if s:
                    out.append('   | ' + s)
    doc.close()

io.open('.scratch/t61/toc_pages.txt', 'w', encoding='utf-8').write('\n'.join(out))
print('written', len(out), 'lines')
