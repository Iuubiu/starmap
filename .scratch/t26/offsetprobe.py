# -*- coding: utf-8 -*-
"""对每本书：取若干 nameOriginal，在 PDF 全文里找它第一次出现的位置，
与 toc.json 里的 printedPage 相减，看偏移是否恒定。"""
import json, os, sys, io, collections
sys.path.insert(0, 'tools/ingest')
import pymupdf

BOOKS = ['knoll-3e-2000','knoll-4e-2010','tsoulfanidis-4e','grupen-2e-2008','ahmed-2e',
         'spieler-2005','leo-2e','nakhostin-2018','rivetti-2015','lutz-2007',
         'nicholson-1974','gilmore-2e-2008','debertin-1988','guojiang-2023','guojiang-2014']
PREFIX = {'knoll-3e-2000':'03_','knoll-4e-2010':'04_','tsoulfanidis-4e':'08_','grupen-2e-2008':'09_',
          'ahmed-2e':'10_','spieler-2005':'11_','leo-2e':'12_','nakhostin-2018':'13_',
          'rivetti-2015':'14_','lutz-2007':'15_','nicholson-1974':'16_','gilmore-2e-2008':'17_',
          'debertin-1988':'20_','guojiang-2023':'26_','guojiang-2014':'27_'}
D = os.path.join('资源库','books')
files = os.listdir(D)
def pdf_for(p):
    m = sorted(f for f in files if f.startswith(p) and f.endswith('.pdf'))
    return os.path.join(D, m[0]) if m else None

out = io.open('.scratch/t26/offsets.txt','w',encoding='utf-8')
for sid in BOOKS:
    path = pdf_for(PREFIX[sid])
    toc = json.load(open('content/%s/toc.json'%sid, encoding='utf-8'))
    doc = pymupdf.open(path)
    # 预取每页前 1200 字符的小写文本
    pages = [doc[i].get_text()[:1500].lower().replace('\n',' ') for i in range(doc.page_count)]
    nodes = [n for n in toc['nodes'] if n.get('printedPage') is not None and (n.get('nameOriginal') or '').strip()]
    # 取 depth<=2 的样本，均匀抽样 12 个
    cand = [n for n in nodes if n['depth'] <= 2] or nodes
    step = max(1, len(cand)//12)
    sample = cand[::step][:12]
    diffs = []
    for n in sample:
        orig = n['nameOriginal'].strip()
        probe = orig[:30].lower()
        # 去掉编号前缀
        import re
        probe2 = re.sub(r'^[\d\.\s]+','', probe).strip()
        hit = None
        for i,t in enumerate(pages):
            if (probe in t) or (probe2 and len(probe2)>8 and probe2 in t):
                hit = i; break
        if hit is not None:
            diffs.append((n['microKpId'], n['printedPage'], hit, hit-n['printedPage']))
    c = collections.Counter(d for _,_,_,d in diffs)
    out.write('=== %s (%s, %d pages) ===\n' % (sid, os.path.basename(path), doc.page_count))
    out.write('  offset votes: %r\n' % (c.most_common(6),))
    for kp, pp, hit, d in diffs[:6]:
        out.write('    %-34s printed=%-5s pdfIdx=%-5s diff=%s\n' % (kp, pp, hit, d))
    doc.close()
out.close()
print(open('.scratch/t26/offsets.txt',encoding='utf-8').read()[:6000])
