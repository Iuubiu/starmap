"""t46 探针 2：英文书 formula 块的分类成因拆解。

目标：把 20155 个 formula 块按 `_looks_like_formula` 的三条判据分别归因，
量出「哪一条判据在英文书上误判最多」，再决定 extract.py 怎么改。
"""
import glob
import json
import os
import re
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

EN = {
    'ahmed-2e', 'debertin-1988', 'gilmore-2e-2008', 'grupen-2e-2008', 'knoll-3e-2000',
    'knoll-4e-2010', 'leo-2e', 'lutz-2007', 'nakhostin-2018', 'nicholson-1974',
    'rivetti-2015', 'spieler-2005', 'tsoulfanidis-4e',
}

# 与 extract.py 保持一致
FORMULA_HINT = set('=∑∫√±×÷∞≈≤≥≠∂Δ')


def alpha_ratio(t):
    if not t:
        return 0.0
    return sum(1 for ch in t if ch.isascii() and ch.isalpha()) / len(t)


def reasons(t):
    """返回这条文本会被哪几条判据判成 formula。"""
    out = []
    if any(ch in FORMULA_HINT for ch in t):
        out.append('hint')
    tokens = t.split()
    if len(tokens) >= 4 and sum(1 for tok in tokens if len(tok) == 1) / len(tokens) > 0.6:
        out.append('single-char')
    if t.endswith(')') and '(' in t and sum(ch.isdigit() for ch in t) >= 3:
        out.append('paren-number')
    return out


def main():
    stat = {}
    samples = {}
    for p in sorted(glob.glob('content/*/chunks.jsonl')):
        sid = os.path.basename(os.path.dirname(p))
        if sid not in EN:
            continue
        for line in open(p, encoding='utf-8'):
            line = line.strip()
            if not line:
                continue
            c = json.loads(line)
            if c.get('kind') != 'formula':
                continue
            t = c.get('text') or ''
            key = tuple(reasons(t))
            stat[key] = stat.get(key, 0) + 1
            samples.setdefault(key, []).append((sid, c['id'], len(t), alpha_ratio(t), t))
    for key, n in sorted(stat.items(), key=lambda kv: -kv[1]):
        arr = samples[key]
        long_prose = sum(1 for _, _, ln, r, _ in arr if ln > 200 and r > 0.55)
        print(f'{str(key):40s} n={n:6d}  long_prose={long_prose:6d}  '
              f'median_len={sorted(x[2] for x in arr)[len(arr) // 2]}')
    print()
    for key in [('paren-number',), ('hint',)]:
        if key not in samples:
            continue
        print(f'=== {key} 样例 ===')
        for sid, cid, ln, r, t in samples[key][:4]:
            print(f'--- {sid} {cid} len={ln} ratio={r:.3f}')
            print(t[:220].replace('\n', ' '))
        print()


if __name__ == '__main__':
    main()
