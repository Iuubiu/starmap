"""列出全部 `未收录术语（…）` 原文，并逐条用当前 translate_title 试译，报还缺哪些词。"""
import collections
import glob
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, 'tools/ingest')
import translate

PAT = re.compile(r'^未收录术语（(.*)）$')

inner = collections.Counter()
for p in sorted(glob.glob('content/*/toc.json')):
    d = json.load(open(p, encoding='utf-8'))
    for n in d.get('nodes', []):
        name = n['name']
        if name.startswith('未收录术语'):
            m = PAT.match(name)
            inner[m.group(1) if m else name] += 1

print(f'distinct {len(inner)}  total {sum(inner.values())}')
still = []
for text, count in inner.most_common():
    translate._MISSING.clear()
    out = translate.translate_title(text)
    missing = dict(translate.untranslated_terms())
    if out.startswith('未收录术语'):
        still.append((text, count, missing))
    print(f'{"FALLBACK" if out.startswith("未收录术语") else "ok      "}\t{count}\t{text}\t=> {out}\tmissing={list(missing)}')

print(f'\nstill falling back: {len(still)}')
words = collections.Counter()
for _, count, missing in still:
    for w, c in missing.items():
        words[w] += 1
print(f'distinct missing words: {len(words)}')
for w, c in words.most_common():
    print(f'{c}\t{w}')
