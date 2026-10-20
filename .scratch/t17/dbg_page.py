import sys
sys.path.insert(0,'tools/ingest')
import pymupdf, numpy as np, cv2
from ocr import render_page
doc=pymupdf.open('资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf')
for i in [60,61]:
    img=render_page(doc,i)
    cv2.imwrite(f'.scratch/t17/p{i}_top.png', img[0:260,:])
    cv2.imwrite(f'.scratch/t17/p{i}_bot.png', img[-140:,:])
    print(i, img.shape)
