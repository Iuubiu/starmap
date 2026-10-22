"""诊断：这些 PDF 到底有没有文字层。"""
import io
import sys

sys.path.insert(0, 'tools/ingest')
import pymupdf  # noqa: E402

BOOKS = [
    '资源库/books/24_模拟电子技术基础_童诗白_华成英_第5版.pdf',
    '资源库/books/18_原子核物理实验方法_修订第3版_1997.pdf',
    '资源库/books/07_核辐射探测器_丁洪林_哈工程2010.pdf',
]

out = []
for pdf in BOOKS:
    doc = pymupdf.open(pdf)
    out.append(f'##### {pdf}  pages={doc.page_count}')
    for i in range(0, min(8, doc.page_count)):
        page = doc[i]
        t = page.get_text()
        out.append(f'  page {i}: textlen={len(t)} images={len(page.get_images())} '
                   f'repr={t[:80]!r}')
    doc.close()

io.open('.scratch/t61/diag.txt', 'w', encoding='utf-8').write('\n'.join(out))
print('ok')
