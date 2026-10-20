import sys, time, re
sys.path.insert(0,'tools/ingest')
import pymupdf, numpy as np
from ocr import OcrEngine
doc=pymupdf.open('资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf')
eng=OcrEngine()
D=re.compile(r'[·•●\-—–+*\s.$§:]*(\d{1,4})[·•●\-—–+*\s.$§:]*$')
def bands(i, frac, dpi):
    r=doc[i].rect; res=[]
    for tag, clip in (('T', pymupdf.Rect(r.x0, r.y0, r.x1, r.y0+r.height*frac)),
                      ('B', pymupdf.Rect(r.x0, r.y1-r.height*frac, r.x1, r.y1))):
        pix=doc[i].get_pixmap(clip=clip, dpi=dpi)
        img=np.frombuffer(pix.samples,dtype=np.uint8).reshape(pix.h,pix.w,pix.n)
        img=np.repeat(img[:,:,:1],3,axis=2) if pix.n<3 else img[:,:,:3][:,:,::-1].copy()
        for l in eng.lines(np.ascontiguousarray(img)):
            res.append((tag, l))
    return res
t0=time.time()
for i in [60,100,120,240,300,340]:
    for frac,dpi in ((0.06,300),(0.06,400)):
        out=[]
        for tag,l in bands(i,frac,dpi):
            t=l.text.strip()
            if t and len(t)<=10:
                m=D.match(t)
                if m: out.append((tag, round(l.conf,2), int(m.group(1)), '%.2f'%(l.y0/ (frac*889*dpi/72))))
        print(f'p{i} frac{frac} dpi{dpi}', out)
print(f'{time.time()-t0:.1f}s')
