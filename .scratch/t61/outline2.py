"""补充：07 丁洪林书签里找「核探测技术」；18/06 从 OCR 缓存 pages.jsonl 找目录页。"""
import io
import json
import sys

sys.path.insert(0, 'tools/ingest')
import pymupdf  # noqa: E402

out = []

# --- 07 outline ---
doc = pymupdf.open('资源库/books/07_核辐射探测器_丁洪林_哈工程2010.pdf')
toc = doc.get_toc(simple=True)
out.append(f'##### 07 outline entries={len(toc)}')
for i, (lvl, t, p) in enumerate(toc[:12]):
    out.append(f'  [{i}] L{lvl} p{p} {t!r}')
idxs = [i for i, (_, t, _) in enumerate(toc) if '核探测技术' in t]
out.append(f'--- needle 核探测技术 -> {idxs[:5]}')
for i in idxs[:2]:
    for j in range(max(0, i - 2), min(len(toc), i + 4)):
        lvl, t, p = toc[j]
        mark = '>>>' if j == i else '   '
        out.append(f'  {mark} [{j}] L{lvl} p{p} {t!r}')
doc.close()

# --- OCR cache for 18 / 06 ---
OCR = {
    'nuclear-physics-experiment-methods-1997': ['带电粒子在靶物质中的慢化', '重带电粒子在物质中的能量损失',
                                                 '重离子的电子阻止本领', '倍增过程统计学',
                                                 '中子全截面测量', '概述'],
    'nuclear-radiation-physics-chenboxian-2011': ['中子探测方法和常用探测器'],
}
for sid, needles in OCR.items():
    path = f'content/{sid}/ocr/pages.jsonl'
    out.append(f'##### OCR {path}')
    pages = []
    with io.open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line:
                pages.append(json.loads(line))
    out.append(f'  ocr pages={len(pages)} keys={sorted(pages[0].keys())}')
    for nd in needles:
        hits = []
        for rec in pages:
            txt = rec.get('text') or ''
            if nd in txt:
                hits.append(rec.get('page'))
        out.append(f'--- needle {nd!r} -> pages {hits[:8]} (n={len(hits)})')
        for rec in pages:
            txt = rec.get('text') or ''
            if nd in txt:
                out.append(f'  === ocr page {rec.get("page")} ===')
                for ln in txt.splitlines():
                    s = ln.strip()
                    if s:
                        out.append('   | ' + s)
                break

io.open('.scratch/t61/outline2.txt', 'w', encoding='utf-8').write('\n'.join(out))
print('written', len(out))
