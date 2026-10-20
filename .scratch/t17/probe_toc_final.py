import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf
from ocr import OcrEngine, ocr_page, parse_toc_pages
from toc import build_tree, flatten

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
eng = OcrEngine()
pages = [ocr_page(eng, doc, i) for i in (10, 11, 12, 13)]
ents = parse_toc_pages(pages)
print('entries', len(ents), 'numbered', sum(1 for n, _, _ in ents if n))
for num, title, page in ents[:20]:
    print(f'  [{num}] {title} p.{page}')
print('...')
tree = build_tree(ents)
flat = flatten(tree)
print('nodes', len(flat), 'maxdepth', max(n.depth for _, n, _ in flat))
