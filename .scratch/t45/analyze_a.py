"""分析 53 组塌缩：区分「原文本身相同（只差编号）」与「原文不同被译成同一个」。"""
import json, sys, collections
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, 'tools/ingest')
import translate as T
from pathlib import Path

CONTENT = Path('content')

def norm_orig(s):
    t = T._TRAIL_PUNCT.sub('', T._LEAD_PUNCT.sub('', T._normalize(s)))
    t = T._TRAIL_PUNCT.sub('', T._LEAD_PUNCT.sub('', T._strip_number(t)))
    return t.strip().lower()

raw_groups = 0; norm_groups = 0
samples_raw = []; samples_norm = []
for p in sorted(CONTENT.glob('*/toc.json')):
    d = json.loads(p.read_text(encoding='utf-8'))
    by = collections.defaultdict(list)
    for n in d.get('nodes', []):
        by[n['name']].append(n)
    for name, ns in by.items():
        origs = {n.get('nameOriginal') or '' for n in ns}
        if len(origs) > 1:
            raw_groups += 1
            if len(samples_raw) < 8:
                samples_raw.append((p.parent.name, name, sorted(origs)[:3], [(n['isLeaf'], n['depth']) for n in ns][:3]))
        norigs = {norm_orig(o) for o in origs if o}
        if len(norigs) > 1:
            norm_groups += 1
            if len(samples_norm) < 12:
                samples_norm.append((p.parent.name, name, sorted(norigs)[:3]))
print('raw groups (nameOriginal distinct):', raw_groups)
print('normalized groups (number-stripped distinct):', norm_groups)
print('--- raw samples ---')
for s in samples_raw: print('  ', s[0], '|', s[1], '|', s[2], '| leaf/depth', s[3])
print('--- normalized samples ---')
for s in samples_norm: print('  ', s[0], '|', s[1], '|', s[2])
