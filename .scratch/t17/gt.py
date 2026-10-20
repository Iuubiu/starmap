import sys
sys.path.insert(0,'tools/ingest')
import pymupdf, numpy as np, cv2
from ocr import render_page
doc=pymupdf.open('资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf')
img=render_page(doc,60)
cv2.imwrite('.scratch/t17/p60_top800.png', img[250:800,:])
print(img.shape)
