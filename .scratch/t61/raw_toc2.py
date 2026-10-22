import sys, io, json
sys.path.insert(0, 'tools/ingest')
import pymupdf

CASES = [
    ('资源库/books/24_模拟电子技术基础_童诗白_华成英_第5版.pdf', ['晶体三极管模型']),
    ('资源库/books/18_原子核物理实验方法_修订第3版_1997.pdf', ['带电粒子在靶物质中的慢化', '重带电粒子在物质中的能量损失', '重离子的电子阻止本领', '倍增过程统计学', '中子全截面测量', '概述']),
    ('资源库/books/06_核辐射物理及探测学_陈伯显_张智_哈工程2011.pdf', ['中子探测方法和常用探测器']),
    ('资源库/books/19_核辐射探测器及其实验技术手册_汲长松_1990.pdf', ['光导纤维光导', '工作原理']),
    ('资源库/books/07_核辐射探测器_丁洪林_哈工程2010.pdf', ['作用与地位']),
]

out = []
for pdf, needles in CASES:
    doc = pymupdf.open(pdf)
    out.append(f'########## {pdf}  pages={doc.page_count}')
    for nd in needles:
        found = []
        for i in range(doc.page_count):
            t = doc[i].get_text()
            if nd in t:
                found.append(i)
        out.append(f'--- needle {nd!r}: pages {found[:12]} (total {len(found)})')
        for i in found[:3]:
            out.append(f'  === PDF page index {i} ===')
            for ln in doc[i].get_text().splitlines():
                s = ln.strip()
                if s:
                    out.append('   | ' + s)
    doc.close()
io.open('.scratch/t61/raw_toc_dump.txt', 'w', encoding='utf-8').write('\n'.join(out))
print('written', len(out), 'lines')
