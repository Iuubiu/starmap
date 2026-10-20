import os
import sys, io, base64, json, time, urllib.request
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import pymupdf

KEY = os.environ["D1API_API_KEY"]
BASE = "https://d1api.xin/v1"

BOOKS = r"D:\DeepSeek\starmap\资源库\books"
# formula-heavy pages from 王芝英 (main nuclear electronics textbook, pure scan)
cases = [
    (r"01_核电子技术原理_王芝英_原子能1989.pdf", 120),
    (r"01_核电子技术原理_王芝英_原子能1989.pdf", 200),
]

PROMPT = ("把这一页完整转写为 Markdown。要求：正文逐行照抄，不要概括、不要补全、不要解释；"
          "公式用 LaTeX，行内用 $...$，独立成行用 $$...$$；表格用 Markdown 表格；"
          "图只写一行 `[图: <图题原文>]`。不要输出任何前言或结语。")

def ocr(model, png, timeout=180):
    b64 = base64.b64encode(png).decode()
    body = {
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64," + b64}},
        ]}],
        "max_tokens": 3000,
        "temperature": 0,
    }
    req = urllib.request.Request(BASE + "/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.loads(r.read())
    dt = time.time() - t0
    u = d.get("usage", {})
    return d["choices"][0]["message"]["content"], dt, u

MODELS = ["glm-5.3", "deepseek-v4.1-flash", "minimax-m3"]

for fn, pn in cases:
    doc = pymupdf.open(BOOKS + "\\" + fn)
    png = doc[pn].get_pixmap(dpi=150).tobytes("png")
    doc.close()
    print("#" * 70)
    print(f"PAGE {fn} p{pn}  png={len(png)//1024}KB")
    for m in MODELS:
        try:
            txt, dt, u = ocr(m, png)
            disp = txt.replace(" ", "·")  # keep spaces visible for format check
            print(f"\n--- {m}  {dt:.1f}s  usage={u}  len={len(txt)}")
            print(txt[:700])
        except Exception as e:
            b = e.read().decode("utf-8", "replace")[:300] if hasattr(e, "read") else ""
            print(f"\n--- {m}  ERR {type(e).__name__} {str(e)[:120]} {b}")
