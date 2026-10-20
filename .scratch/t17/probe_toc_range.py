"""为 10 本书找目录页范围：低 dpi 扫前 30 页，认「目录」和点线页码密度。"""
import sys, json, re, time
sys.path.insert(0, 'tools/ingest')
from ocr import OcrEngine, render_page, OcrLine
import pymupdf

BOOKS = json.load(open('.scratch/t17/books.json', encoding='utf-8'))
eng = OcrEngine()
out = {}
for b in BOOKS:
    doc = pymupdf.open(b['pdf'])
    hits = []
    t0 = time.time()
    for i in range(1, min(31, doc.page_count)):
        img = render_page(doc, i, 110)
        lines = eng.lines(img)
        txt = ''.join(l.text for l in lines)
        # 目录特征：出现「目录」，或右列纯数字行 ≥5 且点线多
        nums = sum(1 for l in lines if re.fullmatch(r'[\s.·•●\-—–+*⋯…]*\d{1,4}[\s.·•●]*', l.text.strip()) and l.x1 > img.shape[1] * 0.7)
        dots = txt.count('…') + txt.count('⋯') + txt.count('..')
        score = 0
        if re.search(r'目\s*录', txt): score += 3
        if nums >= 5: score += 2
        if dots >= 3: score += 1
        if score >= 3:
            hits.append((i, score, len(lines), nums))
    out[b['id']] = {'pages': hits, 'seconds': round(time.time() - t0, 1), 'pageCount': doc.page_count}
    print(b['id'], doc.page_count, hits, flush=True)
json.dump(out, open('.scratch/t17/toc_probe.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
