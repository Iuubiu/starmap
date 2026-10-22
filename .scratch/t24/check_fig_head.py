"""用 HEAD 版 extract.py 跑图注检查（把 HEAD 版临时覆盖到 tools/ingest 再还原）。"""
import json, shutil, subprocess, sys, os
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
src = Path('tools/ingest/extract.py')
backup = Path('.scratch/t24/extract_now.py')
shutil.copy2(src, backup)
try:
    head = subprocess.run(['git', 'show', 'HEAD:tools/ingest/extract.py'],
                          capture_output=True, text=True, encoding='utf-8')
    src.write_text(head.stdout, encoding='utf-8')
    code = subprocess.run([sys.executable, '-c', '''
import json, sys
from pathlib import Path
sys.path.insert(0, "tools/ingest")
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import pymupdf
import extract as m
pdf = "资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf"
out = Path("content/digital-kanghua-5e/chunks.jsonl")
doc = pymupdf.open(pdf)
caps = set()
for pi in range(24, doc.page_count):
    for ln in m._group_lines(m._spans_of(doc[pi])):
        t = "".join(s["text"] for s in ln).strip()
        if m._looks_like_caption(t):
            caps.add(t)
figs = [json.loads(l)["text"] for l in out.open(encoding="utf-8") if json.loads(l)["kind"] == "figure"]
missing = [c for c in caps if not any(c in f for f in figs)]
print(f"图注 {len(caps)}，figure {len(figs)}，缺失 {len(missing)}")
for x in missing[:5]: print("   ", x)
'''], capture_output=True, text=True, encoding='utf-8')
    print(code.stdout[-1500:])
    if code.returncode: print('stderr:', code.stderr[-800:])
finally:
    src.write_text(backup.read_text(encoding='utf-8'), encoding='utf-8')
    print('已还原 extract.py')
