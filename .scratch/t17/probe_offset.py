import sys, time
sys.path.insert(0,'tools/ingest')
import pymupdf, numpy as np
from ocr import OcrEngine

doc=pymupdf.open('资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf')
eng=OcrEngine()

def band_lines(i, frac=0.12, dpi=300):
    r=doc[i].rect; out=[]
    for clip in (pymupdf.Rect(r.x0, r.y0, r.x1, r.y0+r.height*frac),
                 pymupdf.Rect(r.x0, r.y1-r.height*frac, r.x1, r.y1)):
        pix=doc[i].get_pixmap(clip=clip, dpi=dpi)
        img=np.frombuffer(pix.samples,dtype=np.uint8).reshape(pix.h,pix.w,pix.n)
        img=np.repeat(img[:,:,:1],3,axis=2) if pix.n<3 else img[:,:,:3][:,:,::-1].copy()
        out.extend(eng.lines(np.ascontiguousarray(img)))
    return out

import re
D=re.compile(r'[·•●\-—–+*\s.$§:]*(\d{1,4})[·•●\-—–+*\s.$§:]*$')
t0=time.time()
hits=[]
for i in [20,40,60,80,100,120,140,160,180,200,220,240,260,280,300,320]:
    ls=band_lines(i)
    cands=[]
    for l in ls:
        t=l.text.strip()
        if t and len(t)<=8:
            m=D.match(t)
            if m: cands.append((round(l.conf,2), int(m.group(1)), t))
    cands.sort(reverse=True)
    hits.append((i, cands[:3]))
print(f'{time.time()-t0:.1f}s for 16 pages ({(time.time()-t0)/16:.2f}s/page)')
for i,c in hits: print(i, c)
offs={}
for i,c in hits:
    if c: offs.setdefault(i-c[0][1], []).append(i)
print('offsets:', {k:len(v) for k,v in offs.items()})
