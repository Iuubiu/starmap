import os
import sys, io, base64, json, urllib.request
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import pymupdf

KEY = os.environ["D1API_API_KEY"]
BASE = "https://d1api.xin/v1"

# 1) render a page from 王芝英 (pure scan) as PNG
p = r"D:\DeepSeek\starmap\资源库\books\01_核电子技术原理_王芝英_原子能1989.pdf"
doc = pymupdf.open(p)
pg = doc[60]
pix = pg.get_pixmap(dpi=150)
png = pix.tobytes("png")
open(r"D:\DeepSeek\starmap\.scratch\probe2\wzy_p60.png", "wb").write(png)
doc.close()
print("png bytes", len(png), "size", pix.width, "x", pix.height)

b64 = base64.b64encode(png).decode()

models = ["glm-5.3", "glm-5.3-flash", "minimax-m3", "deepseek-v4.1-flash"]

for m in models:
    body = {
        "model": m,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": "把这张图里的中文逐行转写出来，不要解释。"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64," + b64}},
            ],
        }],
        "max_tokens": 600,
        "temperature": 0,
    }
    req = urllib.request.Request(
        BASE + "/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"},
    )
    print("=" * 60)
    print("MODEL", m)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            d = json.loads(r.read())
        txt = d["choices"][0]["message"]["content"]
        print("OK len=", len(txt))
        print(txt[:800])
    except Exception as e:
        body_txt = ""
        if hasattr(e, "read"):
            body_txt = e.read().decode("utf-8", "replace")[:500]
        print("ERR", type(e).__name__, str(e)[:200], body_txt)
