import os, sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import pymupdf

ROOT = r"D:\DeepSeek\starmap\资源库"
rows = []

for cat in sorted(os.listdir(ROOT)):
    d = os.path.join(ROOT, cat)
    if not os.path.isdir(d):
        continue
    for fn in sorted(os.listdir(d)):
        if not fn.lower().endswith('.pdf'):
            continue
        p = os.path.join(d, fn)
        rec = {"cat": cat, "file": fn, "size": os.path.getsize(p)}
        try:
            doc = pymupdf.open(p)
            rec["pages"] = doc.page_count
            # sample up to 12 pages spread through the doc
            n = doc.page_count
            idxs = list(range(min(n, 4)))
            if n > 8:
                idxs += list(range(n // 4, n // 4 + 2))
                idxs += list(range(n // 2, n // 2 + 2))
                idxs += list(range(max(0, n - 3), n))
            idxs = sorted(set(i for i in idxs if 0 <= i < n))
            total_chars = 0
            cjk_chars = 0
            for i in idxs:
                t = doc[i].get_text()
                total_chars += len(t)
                cjk_chars += sum(1 for c in t if '\u4e00' <= c <= '\u9fff')
            rec["sampled"] = len(idxs)
            rec["chars"] = total_chars
            rec["chars_per_page"] = round(total_chars / max(1, len(idxs)), 1)
            rec["cjk"] = cjk_chars
            # text-layer verdict
            if rec["chars_per_page"] < 30:
                rec["verdict"] = "SCAN"      # image only, needs OCR
            elif rec["chars_per_page"] < 300:
                rec["verdict"] = "THIN"      # sparse text layer (bad extraction)
            else:
                rec["verdict"] = "TEXT"
            doc.close()
        except Exception as e:
            rec["error"] = str(e)[:120]
            rec["verdict"] = "ERR"
        rows.append(rec)
        print(f'{rec["verdict"]:5s} {rec.get("pages",0):5d}p {rec.get("chars_per_page",0):8.1f}cp {rec["size"]/1e6:7.1f}MB {cat}/{fn}', flush=True)

with open(r"D:\DeepSeek\starmap\.scratch\probe2\pdfscan.json", "w", encoding="utf-8") as f:
    json.dump(rows, f, ensure_ascii=False, indent=1)

print("\n=== SUMMARY ===")
from collections import Counter
c = Counter(r["verdict"] for r in rows)
print(c)
for v in ["SCAN", "THIN", "ERR"]:
    bad = [r for r in rows if r["verdict"] == v]
    if bad:
        print(f"\n-- {v} ({len(bad)}) --")
        for r in bad:
            print(f'  {r["cat"]}/{r["file"]}  {r.get("chars_per_page",0)}cp {r.get("pages",0)}p')
