"""t46 AC4：全库 formula 块里「像散文的」必须归零，且真公式不丢。

判据（与修复后的 `_looks_like_formula` 散文守卫同构，独立实现，不复用被测函数）：
长度 > 200 且 ASCII 字母占比 > 0.55 且不含汉字。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTENT = ROOT / 'content'
HAN = re.compile(r'[\u4e00-\u9fff]')
OUT = []


def ratio(t):
    return sum(1 for ch in t if ch.isascii() and ch.isalpha()) / len(t) if t else 0.0


def is_prose(t):
    return len(t) > 200 and ratio(t) > 0.55 and not HAN.search(t)


total_formula = 0
prose = 0
samples = []
per_book = []
for f in sorted(CONTENT.glob('*/chunks.jsonl')):
    sid = f.parent.name
    n_f = n_p = 0
    for line in f.read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        c = json.loads(line)
        if c.get('kind') != 'formula':
            continue
        n_f += 1
        t = (c.get('text') or '').strip()
        if is_prose(t):
            n_p += 1
            if len(samples) < 10:
                samples.append((sid, len(t), round(ratio(t), 3), t[:120]))
    total_formula += n_f
    prose += n_p
    per_book.append((sid, n_f, n_p))

OUT.append(f'formula 总数: {total_formula}')
OUT.append(f'仍像散文的 formula: {prose}')
OUT.append('')
OUT.append('逐本 (sourceId, formula, prose-like):')
for sid, n_f, n_p in per_book:
    OUT.append(f'  {sid:46s} {n_f:6d} {n_p:4d}')
if samples:
    OUT.append('')
    OUT.append('样例:')
    for sid, ln, r, t in samples:
        OUT.append(f'  [{sid}] len={ln} ascii={r}\n    {t!r}')
(ROOT / '.scratch' / 't46' / 'ac4.txt').write_text('\n'.join(OUT), encoding='utf-8')
print('\n'.join(OUT[:6]))
