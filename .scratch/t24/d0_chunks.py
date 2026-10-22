"""5 个 depth=0 叶节点各自挂了多少 chunk、分布在哪些页 —— 用来判断该降级还是该改名。"""
import glob, json, os, sys
from collections import Counter
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

TARGETS = {
    'kp-lihansun-5e-vol1-p2-上册': 'circuit-analysis-lihansun-5e-vol1',
    'kp-yanshi-6e-p1-绪论': 'digital-electronics-yanshi-6e',
    'kp-wangzhiying-1989-p1-目電录': 'nuclear-electronics-wangzhiying-1989',
    'kp-wangzhiying-1989-p1-绪论': 'nuclear-electronics-wangzhiying-1989',
    'kp-jichangsong-1990-p1-概念与术语': 'radiation-detector-handbook-jichangsong-1990',
}
for kp, sid in TARGETS.items():
    chunks = [json.loads(l) for l in open(f'content/{sid}/chunks.jsonl', encoding='utf-8') if l.strip()]
    mine = [c for c in chunks if c.get('micro_kp_id') == kp]
    pages = sorted({c['printed_page'] for c in mine})
    kinds = Counter(c['kind'] for c in mine)
    print(f'{kp}')
    print(f'   chunk {len(mine)}  kind={dict(kinds)}  页 {pages[:12]}{"…" if len(pages)>12 else ""} 共 {len(pages)} 页')
    for c in mine[:3]:
        print(f'     p{c["printed_page"]} [{c["kind"]}] {c["text"][:70]!r}')
    print()
