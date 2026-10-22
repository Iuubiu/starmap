# -*- coding: utf-8 -*-
"""先重译、再全剥编号，看剥完还剩多少叶节点重名。"""
import json, re, sys
from collections import defaultdict
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools' / 'ingest'))
from translate import load_overrides, make_translator
TR = make_translator(load_overrides())
NUM = re.compile(r'^\s*\d+(?:\.\d+)+\s+')
SEC = re.compile(r'^[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*\.?\s+')

def norm_orig(o):
    return re.sub(r'\s+', ' ', SEC.sub('', (o or '').strip()).lower())

tot = defaultdict(int)
for p in sorted((ROOT/'content').glob('*/toc.json')):
    sid = p.parent.name
    toc = json.loads(p.read_text(encoding='utf-8'))
    nodes = toc.get('nodes') or []
    for n in nodes:
        o = (n.get('nameOriginal') or '').strip()
        if o:
            n['name'] = TR(o)
        num = (n.get('num') or '').strip()
        nm = (n.get('name') or '').strip()
        if o and num and NUM.match(nm) and nm.startswith(num + ' '):
            n['name'] = nm[len(num):].lstrip()
    # 叶节点重名
    leaves = defaultdict(list)
    for n in nodes:
        if n.get('isLeaf'):
            leaves[(n.get('name') or '').strip()].append(n)
    clash = {k: v for k, v in leaves.items() if len(v) > 1}
    # A 口径：同名但 norm_orig 不同
    by = defaultdict(set); who = defaultdict(list)
    for n in nodes:
        by[(n.get('name') or '').strip()].add(norm_orig(n.get('nameOriginal') or ''))
        who[(n.get('name') or '').strip()].append(n)
    a = [(nm, {o for o in os_ if o}) for nm, os_ in by.items() if len({o for o in os_ if o}) > 1]
    tot['clashGroups'] += len(clash)
    tot['clashNodes'] += sum(len(v) for v in clash.values())
    tot['Agroups'] += len(a)
    if clash or a:
        print(f'{sid:42s} clash={len(clash):3d}/{sum(len(v) for v in clash.values()):3d} A={len(a):3d}')
        for k, v in list(clash.items())[:4]:
            print('    clash', k, [x['microKpId'] for x in v])
print(dict(tot))
