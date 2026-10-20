import sys, time, re
sys.path.insert(0,'tools/ingest')
import pymupdf, numpy as np
from ocr import OcrEngine
doc=pymupdf.open('资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf')
eng=OcrEngine()
D=re.compile(r'[·•●\-—–+*\s.$§:]*(\d{1,4})[·•●\-—–+*\s.$§:]*$')
def band(i, frac, dpi, top=True):
    r=doc[i].rect
    clip = pymupdf.Rect(r.x0, r.y0, r.x1, r.y0+r.height*frac) if top else pymupdf.Rect(r.x0, r.y1-r.height*frac, r.x1, r.y1)
    pix=doc[i].get_pixmap(clip=clip, dpi=dpi)
    img=np.frombuffer(pix.samples,dtype=np.uint8).reshape(pix.h,pix.w,pix.n)
    img=np.repeat(img[:,:,:1],3,axis=2) if pix.n<3 else img[:,:,:3][:,:,::-1].copy()
    return list(eng.lines(np.ascontiguousarray(img)))
for i in [100,120,240]:
    for frac in (0.12, 0.08):
        for dpi in (300,):
            top=band(i,frac,dpi,True); bot=band(i,frac,dpi,False)
            print(f'p{i} frac{frac} TOP', [(l.text, round(l.conf,2), round(l.y0), round(l.y1)) for l in top][:6])
            print(f'p{i} frac{frac} BOT', [(l.text, round(l.conf,2), round(l.y0), round(l.y1)) for l in bot][:6])
