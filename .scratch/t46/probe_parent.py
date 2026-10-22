import json, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
def ar(t): return sum(1 for c in t if c.isascii() and c.isalpha())/max(1,len(t))
def cjk(t): return sum(1 for ch in t if '\u4e00'<=ch<='\u9fff')
targets=[]
for d in sorted(Path('content').iterdir()):
    f=d/'chunks.jsonl'
    if not f.is_file(): continue
    rows=[json.loads(l) for l in f.read_text(encoding='utf-8').splitlines()]
    # group by (source, pdf_page) to reconstruct sibling text
    for c in rows:
        t=c.get('text') or ''
        if c.get('kind')=='formula' and len(t)>200 and ar(t)>0.55 and cjk(t)==0:
            targets.append((d.name, c))
print('targets', len(targets))
for sid, c in targets:
    print(f'--- {sid} {c["id"]} page={c.get("pdf_page")} len={len(c["text"])} ar={ar(c["text"]):.2f}')
    print(f'    text: {c["text"][:100]!r}')
    print(f'    meta keys: {list(c.keys())}')
