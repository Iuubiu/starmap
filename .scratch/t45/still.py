# -*- coding: utf-8 -*-
import json, re, sys
from collections import defaultdict
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools' / 'ingest'))
from translate import make_translator, load_overrides, _translate_words, _normalize, _strip_number
TR = make_translator(load_overrides())
NUM = re.compile(r'^\s*\d+(?:\.\d+)+\s+')
def norm(o):
    return re.sub(r'\s+', ' ', NUM.sub('', o or '').strip().lower())
for p in sorted((ROOT/'content').glob('*/toc.json')):
    sid = p.parent.name
    toc = json.loads(p.read_text(encoding='utf-8'))
    by = defaultdict(set)
    for n in toc.get('nodes', []):
        by[(n.get('name') or '').strip()].add(norm(n.get('nameOriginal') or ''))
    for nm, origs in by.items():
        origs = {o for o in origs if o}
        if len(origs) < 2: continue
        outs = {TR(o): o for o in origs}
        if len(outs) < len(origs):
            print('STILL', sid, '|', nm)
            for o in sorted(origs):
                print('    ', o, '->', TR(o))
