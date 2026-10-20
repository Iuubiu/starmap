import sys
sys.path.insert(0, 'tools/ingest')
import pymupdf
from ocr import OcrEngine, render_page

BOOK='资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf'
doc=pymupdf.open(BOOK); eng=OcrEngine()
for i in [60,61,100]:
    img=render_page(doc,i)
    h,w=img.shape[:2]
    lines=eng.lines(img)
    print(f'=== p{i} {w}x{h} lines={len(lines)}')
    print('  TOP:', [(l.text, round(l.y0), round(l.y1), round(l.conf,2)) for l in lines[:3]])
    print('  BOT:', [(l.text, round(l.y0), round(l.y1), round(l.conf,2)) for l in lines[-3:]])
    print('  near-top/bottom 8%:', [(l.text,round(l.y0),round(l.y1)) for l in lines if l.y0<=h*0.08 or l.y1>=h*0.92])
