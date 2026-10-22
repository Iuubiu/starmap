"""用 nameOriginal（英文原文）重跑 translate_title，报真实的兜底数。"""
import collections
import glob
import json
import re
import sys

sys.path.insert(0, 'tools/ingest')
import translate

rows = []
for p in sorted(glob.glob('content/*/toc.json')):
    d = json.load(open(p, encoding='utf-8'))
    for n in d.get('nodes', []):
        name = n['name']
        if not name.startswith('未收录术语'):
            continue
        original = n.get('nameOriginal') or ''
        translate._MISSING.clear()
        out = translate.translate_title(original)
        missing = list(translate.untranslated_terms())
        rows.append((d['sourceId'], n['microKpId'], name, original, out, missing))

print(f'total fallback nodes in toc: {len(rows)}')
still = [r for r in rows if r[4].startswith('未收录术语')]
print(f'would still fall back: {len(still)}')
for sid, kid, name, original, out, missing in still:
    print(f'  {sid}\t{kid}\t{original!r}\tmissing={missing}')
print('\n--- would become:')
seen = {}
for sid, kid, name, original, out, missing in rows:
    if r := seen.get(original):
        continue
    seen[original] = out
    print(f'{original!r}  ->  {out!r}')
