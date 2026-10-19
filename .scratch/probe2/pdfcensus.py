import sys, io, os, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import pymupdf

B = r"D:\DeepSeek\starmap\资源库\books"
out = []
for fn in sorted(os.listdir(B)):
    if not fn.lower().endswith(".pdf"):
        continue
    p = os.path.join(B, fn)
    doc = pymupdf.open(p)
    n = doc.page_count
    # sample every page for small docs, every k-th for big
    k = max(1, n // 40)
    idxs = list(range(0, n, k))
    has = 0
    for i in idxs:
        if len(doc[i].get_text().strip()) > 50:
            has += 1
    frac = has / len(idxs)
    doc.close()
    out.append((fn, n, frac))
    print(f"{frac*100:5.1f}%  {n:5d}p  {fn}", flush=True)

print("\n=== books with <20% text pages (need OCR) ===")
tot = sum(n for _, n, _ in out)
ocr = sum(n for _, n, f in out if f < 0.2)
for fn, n, f in out:
    if f < 0.2:
        print(f"  {f*100:5.1f}%  {n:5d}p  {fn}")
print(f"\ntotal pages={tot}  ocr-needed={ocr} ({ocr/tot*100:.1f}%)")
