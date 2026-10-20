import sys, time
sys.path.insert(0,'tools/ingest')
import pymupdf
from ocr import OcrEngine, render_page
doc=pymupdf.open('资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf')
img=render_page(doc,60)
for mh in (30, 20, 12):
    eng=OcrEngine(); eng._engine.min_height=mh
    t0=time.time(); lines=eng.lines(img); dt=time.time()-t0
    tops=[(l.text, round(l.y0), round(l.y1)) for l in lines if l.y1<330 or l.y0>2200]
    print(f'min_height={mh} lines={len(lines)} {dt:.2f}s edge-lines={tops[:6]}')
