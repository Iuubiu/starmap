import collections, glob, json, re, sys
sys.path.insert(0, 'tools/ingest')
import translate
PAT = re.compile(r'^未收录术语（(.*)）$')
rows = collections.Counter()
for p in sorted(glob.glob('content/*/toc.json')):
    d = json.load(open(p, encoding='utf-8'))
    for n in d.get('nodes', []):
        if n['name'].startswith('未收录术语'):
            m = PAT.match(n['name'])
            rows[(d['sourceId'], m.group(1) if m else n['name'])] += 1
seen = {}
for (sid, inner), c in rows.items():
    seen.setdefault(inner, []).append(sid)
for inner in sorted(seen):
    translate._MISSING.clear()
    out = translate.translate_title(inner)
    print(f'{inner}\t=> {out}\t[{",".join(sorted(set(seen[inner])))}]')
print('distinct', len(seen))
