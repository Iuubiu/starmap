# -*- coding: utf-8 -*-
"""用 books 自己的 detect_page_offset_text 反推偏移，再核对 toc.json 的 printedPage。"""
import json, os, sys, io, re
sys.path.insert(0, 'tools/ingest')
import pymupdf
from toc_books import detect_page_offset_text

BOOKS = {
 'knoll-3e-2000':'03_','knoll-4e-2010':'04_','tsoulfanidis-4e':'08_','grupen-2e-2008':'09_',
 'ahmed-2e':'10_','spieler-2005':'11_','leo-2e':'12_','nakhostin-2018':'13_',
 'rivetti-2015':'14_','lutz-2007':'15_','nicholson-1974':'16_','gilmore-2e-2008':'17_',
 'debertin-1988':'20_','guojiang-2023':'26_','guojiang-2014':'27_'}
D = os.path.join('资源库','books')
files = os.listdir(D)
def pdf_for(p):
    m = sorted(f for f in files if f.startswith(p) and f.endswith('.pdf'))
    return os.path.join(D, m[0]) if m else None

out = io.open('.scratch/t26/pages.txt','w',encoding='utf-8')
for sid, pref in BOOKS.items():
    path = pdf_for(pref)
    doc = pymupdf.open(path)
    toc = json.load(open('content/%s/toc.json'%sid, encoding='utf-8'))
    nodes = toc['nodes']
    pages = [n.get('printedPage') for n in nodes if n.get('printedPage') is not None]
    # 抽 5 个 depth<=2 且非附件的节点
    cand = [n for n in nodes if n['depth'] <= 2 and not n.get('appendix') and n.get('nameOriginal')]
    step = max(1, len(cand)//5)
    sample = cand[::step][:5]
    out.write('=== %s (%d pages, %d nodes, printedPage %s..%s) ===\n'
              % (sid, doc.page_count, len(nodes), min(pages), max(pages)))
    # 对每个样本：在 PDF 里找标题第一次出现在「页首 500 字符」的页（跳过目录区）
    hits = []
    for n in sample:
        orig = re.sub(r'^[\d\.\s]+', '', n['nameOriginal']).strip().lower()
        probe = orig[:28]
        found = None
        for i in range(20, doc.page_count):   # 跳过目录区
            head = doc[i].get_text()[:500].lower().replace('\n', ' ')
            if probe and probe in head:
                found = i
                break
        hits.append((n['microKpId'], n['name'][:20], n['nameOriginal'][:30], n['printedPage'], found))
    diffs = [h[4]-h[3] for h in hits if h[4] is not None]
    out.write('  diffs(pdfIdx - printedPage) = %r\n' % (diffs,))
    for kp, nm, orig, pp, f in hits:
        out.write('    %-32s printed=%-5s pdfIdx=%-5s %s\n' % (kp, pp, f, orig))
    doc.close()
out.close()
print(open('.scratch/t26/pages.txt',encoding='utf-8').read())
