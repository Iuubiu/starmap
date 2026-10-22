"""t46 探针：英文书 formula 块的形态分布 + 真公式抽样。"""
import glob
import json
import os
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

EN = {
    'ahmed-2e', 'debertin-1988', 'gilmore-2e-2008', 'grupen-2e-2008', 'knoll-3e-2000',
    'knoll-4e-2010', 'leo-2e', 'lutz-2007', 'nakhostin-2018', 'nicholson-1974',
    'rivetti-2015', 'spieler-2005', 'tsoulfanidis-4e',
}


def alpha_ratio(t):
    if not t:
        return 0.0
    return sum(1 for ch in t if ch.isascii() and ch.isalpha()) / len(t)


def main():
    buckets = {'short': 0, 'long_lowletter': 0, 'long_highletter': 0}
    long_highletter = []
    long_lowletter = []
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
            if len(t) <= 200:
                buckets['short'] += 1
            elif alpha_ratio(t) > 0.55:
                buckets['long_highletter'] += 1
                long_highletter.append((sid, c['id'], t))
            else:
                buckets['long_lowletter'] += 1
                long_lowletter.append((sid, c['id'], t))
    print('buckets', buckets)
    print()
    print('=== 长且字母占比高的前 5 条（被判为散文的候选） ===')
    for sid, cid, t in long_highletter[:5]:
        print(f'--- {sid} {cid} len={len(t)} ratio={alpha_ratio(t):.3f}')
        print(t[:260].replace('\n', ' '))
    print()
    print('=== 长且字母占比低的前 15 条（必须保持 formula 的真公式候选） ===')
    for sid, cid, t in long_lowletter[:15]:
        print(f'--- {sid} {cid} len={len(t)} ratio={alpha_ratio(t):.3f}')
        print(t[:200].replace('\n', ' '))


if __name__ == '__main__':
    main()
