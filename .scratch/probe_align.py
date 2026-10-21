# -*- coding: utf-8 -*-
"""核对每本书：节点标题是否真的出现在它自己 printedPage 附近的 chunk 里。

这是「页码翻回 PDF 能对上标题」的自动化版本 —— 不靠人眼抽查 5 条，
把每本 depth<=2 的节点全查一遍，报命中率。命中率低说明页偏移或
逐页表错了，`assign` 会把正文挂到邻居知识点上而全程不报错。
"""
import io, json, re, sys, unicodedata
from pathlib import Path

CONTENT = Path('content')
BOOKS = ['knoll-3e-2000','knoll-4e-2010','tsoulfanidis-4e','grupen-2e-2008','ahmed-2e',
         'spieler-2005','leo-2e','nakhostin-2018','rivetti-2015','lutz-2007',
         'nicholson-1974','gilmore-2e-2008','debertin-1988','guojiang-2023','guojiang-2014']

def norm(s):
    s = unicodedata.normalize('NFKD', s).lower()
    return re.sub(r'[^a-z0-9\u4e00-\u9fff]', '', s)

for sid in BOOKS:
    toc = json.load(io.open(CONTENT / sid / 'toc.json', encoding='utf-8'))
    nodes = toc['nodes']
    chunks = [json.loads(l) for l in io.open(CONTENT / sid / 'chunks.jsonl', encoding='utf-8')]
    by_page = {}
    for c in chunks:
        by_page.setdefault(c['printed_page'], []).append(norm(c['text'][:4000]))
    tried = hit = 0
    misses = []
    for n in nodes:
        if n['depth'] > 2:
            continue
        key = norm(n.get('nameOriginal') or n['name'])[:22]
        if len(key) < 8:
            continue
        tried += 1
        p = n['printedPage']
        window = ''.join(by_page.get(q, [''])[0] for q in (p-1, p, p+1))
        if key in window:
            hit += 1
        elif len(misses) < 3:
            misses.append((n['num'], n['printedPage'], (n.get('nameOriginal') or n['name'])[:40]))
    rate = hit / tried if tried else 0
    print(f'{sid:16s} {hit:4d}/{tried:4d} = {rate:5.1%}  misses={misses}')
