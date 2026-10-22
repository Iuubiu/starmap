# -*- coding: utf-8 -*-
"""t45 三项指标的当前实测。"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools' / 'ingest'))
from translate import make_translator, load_overrides  # noqa: E402

CONTENT = ROOT / 'content'
TR = make_translator(load_overrides())
NUM = re.compile(r'^\s*\d+(?:\.\d+)+\s+')


def norm(orig: str) -> str:
    t = NUM.sub('', orig or '').strip().lower()
    return re.sub(r'\s+', ' ', t)


def tocs():
    for p in sorted(CONTENT.glob('*/toc.json')):
        yield p.parent.name, json.loads(p.read_text(encoding='utf-8'))


# ---- A：同书内 name 相同但 norm(nameOriginal) 不同 ----
groups = 0
nodes_a = 0
detail_a = []
for sid, toc in tocs():
    by_name = defaultdict(set)
    who = defaultdict(list)
    for n in toc.get('nodes', []):
        nm = (n.get('name') or '').strip()
        by_name[nm].add(norm(n.get('nameOriginal') or ''))
        who[nm].append(n)
    for nm, origs in by_name.items():
        origs = {o for o in origs if o}
        if len(origs) > 1:
            groups += 1
            nodes_a += len(who[nm])
            detail_a.append((sid, nm, sorted(origs), [n['microKpId'] for n in who[nm]]))

print('A groups', groups, 'nodes', nodes_a)

# ---- A'：补词后逐组重译，看是否还会塌缩 ----
still = 0
for sid, nm, origs, ids in detail_a:
    outs = {TR(o) for o in origs}
    if len(outs) < len(origs):
        still += 1
print('A after retranslate: still collapsed', still)

# ---- B：name 以自身 num 开头 ----
b_total = b_translated = b_native = 0
for sid, toc in tocs():
    for n in toc.get('nodes', []):
        num = (n.get('num') or '').strip()
        nm = (n.get('name') or '').strip()
        if not num or not NUM.match(nm):
            continue
        if not nm.startswith(num + ' '):
            continue
        b_total += 1
        if (n.get('nameOriginal') or '').strip():
            b_translated += 1
        else:
            b_native += 1
print('B total', b_total, 'translated', b_translated, 'native', b_native)

# ---- C ----
for sid in ('nuclear-electronics-wangjingjin-1983',):
    toc = json.loads((CONTENT / sid / 'toc.json').read_text(encoding='utf-8'))
    for n in toc['nodes']:
        if n['microKpId'] in ('kp-wangjingjin-1983-p75-1131', 'kp-wangjingjin-1983-p76-道宽选择',
                              'kp-wangjingjin-1983-p121-g1343', 'kp-wangjingjin-1983-p122-多路脉冲幅度分析'):
            print('C', n['microKpId'], repr(n['name']), 'num=', repr(n.get('num')), 'p=', n.get('printedPage'))

for row in detail_a:
    print('A:', row[0], '|', row[1], '<-', row[2])
