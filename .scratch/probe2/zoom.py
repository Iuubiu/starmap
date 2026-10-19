import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import pymupdf

p = r"D:\DeepSeek\starmap\资源库\books\01_核电子技术原理_王芝英_原子能1989.pdf"
doc = pymupdf.open(p)
pg = doc[200]
r = pg.rect
# the sentence "重复频率可达到10^XHz" is at ~78% height, left-ish
clip = pymupdf.Rect(r.x0 + r.width * 0.30, r.y0 + r.height * 0.755,
                    r.x0 + r.width * 0.75, r.y0 + r.height * 0.805)
pix = pg.get_pixmap(dpi=900, clip=clip)
pix.save(r"D:\DeepSeek\starmap\.scratch\probe2\p200_zoom.png")
print(pix.width, pix.height)
doc.close()
