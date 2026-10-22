"""对 53 组塌缩节点，找出 nameOriginal 里查不到 GLOSSARY 的词。"""
import json, sys, collections
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, 'tools/ingest')
import translate as T
from pathlib import Path

CONTENT = Path('content')
missing = collections.Counter()
per_word_group = collections.defaultdict(set)

for p in sorted(CONTENT.glob('*/toc.json')):
    d = json.loads(p.read_text(encoding='utf-8'))
    by = collections.defaultdict(list)
    for n in d.get('nodes', []):
        if not n.get('nameOriginal'):
            continue
        by[n['name']].append(n)
    for name, ns in by.items():
        origs = {n['nameOriginal'] for n in ns}
        if len(origs) <= 1:
            continue
        for n in ns:
            orig = n['nameOriginal']
            text = T._TRAIL_PUNCT.sub('', T._LEAD_PUNCT.sub('', T._normalize(orig)))
            text = T._TRAIL_PUNCT.sub('', T._LEAD_PUNCT.sub('', T._strip_number(text)))
            text = T._TRAIL_PUNCT.sub('', T._LEAD_PUNCT.sub('', T._LEAD_ARTICLE.sub('', text)))
            words = T._WORD.findall(text)
            i = 0
            while i < len(words):
                hit = T._lookup(words, i, T.GLOSSARY)
                if hit is not None:
                    i += hit[0]
                    continue
                w = words[i]
                lw = w.lower()
                if lw in T.DROP_TOKENS or w.isdigit() or not w[0].isalpha():
                    i += 1
                    continue
                if lw in T.KEEP_TOKENS or T._stem(lw) in T.KEEP_TOKENS:
                    i += 1
                    continue
                missing[T._stem(lw)] += 1
                per_word_group[T._stem(lw)].add((p.parent.name, orig))
                i += 1

print('missing distinct:', len(missing))
for w, c in missing.most_common():
    print(f'{c:3d}  {w:24s}  e.g. {sorted(per_word_group[w])[0][1][:56]}')
