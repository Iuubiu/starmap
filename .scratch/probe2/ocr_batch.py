import os
import sys, io, base64, json, time, re, urllib.request
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import pymupdf

KEY = os.environ["D1API_API_KEY"]
BASE = "https://d1api.xin/v1"
BOOKS = r"D:\DeepSeek\starmap\资源库\books"

PROMPT = ("把这一页完整转写为 Markdown。正文逐行照抄，不要概括、不要补全、不要解释；"
          "公式用 LaTeX（行内 $...$，独立 $$...$$）；表格用 Markdown 表格；图写一行 `[图: <图题>]`。"
          "**特别注意上下标、指数、单位、数字必须逐字符准确**。只输出转写结果。")

def ocr(model, png, timeout=200):
    b64 = base64.b64encode(png).decode()
    body = {"model": model,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64," + b64}}]}],
        "max_tokens": 3500, "temperature": 0}
    req = urllib.request.Request(BASE + "/chat/completions", data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.loads(r.read())
    return d["choices"][0]["message"]["content"], time.time() - t0, d.get("usage", {})

MODEL = "glm-5.3"
# 王芝英 pages spread across chapters, formula/table heavy
PAGES = [30, 75, 120, 160, 200, 250, 300, 330]
doc = pymupdf.open(BOOKS + r"\01_核电子技术原理_王芝英_原子能1989.pdf")

out = []
for pn in PAGES:
    png = doc[pn].get_pixmap(dpi=150).tobytes("png")
    try:
        txt, dt, u = ocr(MODEL, png)
        nums = sorted(set(re.findall(r"\d+(?:\.\d+)?", txt)))
        out.append({"page": pn, "sec": round(dt, 1), "credit": u.get("credit"),
                    "chars": len(txt), "n_numbers": len(nums), "text": txt})
        print(f"p{pn:3d} {dt:5.1f}s credit={u.get('credit')} chars={len(txt):5d} nums={len(nums):3d}", flush=True)
    except Exception as e:
        b = e.read().decode("utf-8", "replace")[:200] if hasattr(e, "read") else ""
        print(f"p{pn:3d} ERR {type(e).__name__} {str(e)[:100]} {b}", flush=True)
doc.close()

json.dump(out, open(r"D:\DeepSeek\starmap\.scratch\probe2\ocr_glm.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("\ntotal sec", sum(o["sec"] for o in out), " total credit", sum(o["credit"] or 0 for o in out))
