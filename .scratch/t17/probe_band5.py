import sys, time, re
sys.path.insert(0,'tools/ingest')
import numpy as np
from ocr import OcrEngine, render_page
import pymupdf
doc=pymupdf.open('资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf')
eng=OcrEngine()
D=re.compile(r'[·•●\-—–+*\s.$§:]*(\d{1,4})[·•●\-—–+*\s.$§:]*$')
def band_lines(img, frac=0.12):
    h=img.shape[0]; n=int(h*frac); out=[]
    for sub in (img[:n], img[-n:]):
        out.extend(eng.lines(np.ascontiguousarray(sub)))
    return out
t0=time.time(); res={}
for i in [20,60,100,120,140,160,200,240,260,300,320,340]:
    img=render_page(doc,i)
    ls=band_lines(img)
    c=[(round(l.conf,2), int(D.match(l.text.strip()).group(1)), l.text) for l in ls if l.text.strip() and len(l.text.strip())<=10 and D.match(l.text.strip())]
    c.sort(reverse=True)
    res[i]=c[:2]
print(f'{(time.time()-t0)/12:.2f}s/page for band pass')
off={}
for i,c in res.items():
    if c: off.setdefault(i-c[0][1],[]).append(i)
print('offsets', {k:len(v) for k,v in off.items()})
for i in res: print(i, res[i])
