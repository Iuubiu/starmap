import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import pymupdf

p = r"D:\DeepSeek\starmap\资源库\books\01_核电子技术原理_王芝英_原子能1989.pdf"
doc = pymupdf.open(p)
pg = doc[200]
# full page at high dpi for reading
pix = pg.get_pixmap(dpi=200)
pix.save(r"D:\DeepSeek\starmap\.scratch\probe2\p200_full.png")
print("full", pix.width, pix.height)

# crop the region containing "10^?Hz"  -- search by rendering bands
# page 200 text mentions 重复频率; crop lower half
r = pg.rect
print("page rect", r)
clip = pymupdf.Rect(r.x0, r.y0 + r.height * 0.10, r.x1, r.y0 + r.height * 0.55)
pix2 = pg.get_pixmap(dpi=400, clip=clip)
pix2.save(r"D:\DeepSeek\starmap\.scratch\probe2\p200_crop.png")
print("crop", pix2.width, pix2.height)
doc.close()
