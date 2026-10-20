import sys, time
sys.path.insert(0,'tools/ingest')
import pymupdf, numpy as np
from ocr import OcrEngine
doc=pymupdf.open('资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf')
eng=OcrEngine()
for i in [60,61,100,120]:
    r=doc[i].rect
    for name, clip in (('top', pymupdf.Rect(r.x0, r.y0, r.x1, r.y0+r.height*0.12)),
                       ('bot', pymupdf.Rect(r.x0, r.y1-r.height*0.12, r.x1, r.y1))):
        for dpi in (300,):
            pix=doc[i].get_pixmap(clip=clip, dpi=dpi)
            img=np.frombuffer(pix.samples,dtype=np.uint8).reshape(pix.h,pix.w,pix.n)
            img=np.repeat(img[:,:,0:1],3,axis=2) if pix.n<3 else img[:,:,:3][:,:,::-1].copy()
            t0=time.time(); lines=eng.lines(img); dt=time.time()-t0
            print(f'p{i} {name} dpi{dpi} {pix.w}x{pix.h} {dt:.2f}s', [(l.text, round(l.conf,2)) for l in lines][:8])
