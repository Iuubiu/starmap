import sys, json
sys.path.insert(0,'tools/ingest')
import pymupdf
from ocr import OcrEngine, ocr_page, parse_toc_ocr
doc=pymupdf.open('资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf')
eng=OcrEngine()
for i in range(4,16):
    p=ocr_page(eng,doc,i)
    lines=[b.text for b in p.blocks if b.kind!='figure']
    ents=parse_toc_ocr(lines)
    print(i, 'lines',p.line_count,'chars',p.char_count,'entries',len(ents), lines[:2])
