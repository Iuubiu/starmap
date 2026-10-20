import sys, glob
sys.path.insert(0, 'tools/ingest')
import pymupdf, numpy as np
from PIL import Image

pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
pix = doc[10].get_pixmap(dpi=200)
img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
h, w = img.shape[:2]
crop = img[380:780, int(w * 0.65) :]
Image.fromarray(crop).resize((crop.shape[1] * 2, crop.shape[0] * 2), Image.LANCZOS).save(
    '.scratch/t17/toc_nums_p10.png'
)
print('saved', crop.shape)
