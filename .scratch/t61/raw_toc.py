import sys, re
sys.path.insert(0, 'tools/ingest')
import pymupdf

CASES = {
    '资源库/books/24_模拟电子技术基础_童诗白_华成英_第5版.pdf': ['晶体三极管模型'],
    '资源库/books/18_原子核物理实验方法_修订第3版_1997.pdf': ['带电粒子在靶物质中的慢化', '重带电粒子在物质中的能量损失', '重离子的电子阻止本领', '倍增过程统计学', '中子全截面测量', '概述'],
    '资源库/books/06_核辐射物理及探测学_陈伯显_张智_哈工程2011.pdf': ['中子探测方法和常用探测器'],
    '资源库/books/19_核辐射探测器及其实验技术手册_汲长松_1990.pdf': ['光导纤维光导', '工作原理'],
    '资源库/books/07_核辐射探测器_丁洪林_哈工程2010.pdf': ['作用与地位'],
}

for pdf, needles in CASES.items():
    doc = pymupdf.open(pdf)
    print(f'\n########## {pdf.split("/")[-1]}  pages={doc.page_count}')
    hits = []
    for i in range(min(40, doc.page_count)):
        t = doc[i].get_text()
        for nd in needles:
            if nd in t:
                hits.append((i, nd))
    seen = set()
    for i, nd in hits:
        if i in seen: continue
        seen.add(i)
        print(f'--- PDF page index {i} ---')
        lines = doc[i].get_text().splitlines()
        for ln in lines:
            s = ln.strip()
            if not s: continue
            print('   |', s)
    doc.close()
