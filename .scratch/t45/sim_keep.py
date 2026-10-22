"""模拟：把 _translate_words 的「查不到就丢弃」改成「保留原文」，测影响面。"""
import json, sys, re, collections
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, 'tools/ingest')
import translate as T
from pathlib import Path

CONTENT = Path('content')

def _translate_words_keep(text):
    words = T._WORD.findall(text)
    pieces = []
    index = 0
    while index < len(words):
        hit = T._lookup(words, index, T.GLOSSARY)
        if hit is not None:
            size, chinese = hit
            phrase = ' '.join(words[index:index+size]).lower()
            is_connector = phrase in T.CONNECTORS or T._stem(phrase) in T.CONNECTORS
            if chinese:
                pieces.append((chinese, is_connector))
            index += size
            continue
        word = words[index]
        lowered = word.lower()
        if lowered in T.DROP_TOKENS or word.isdigit() or not word[0].isalpha():
            index += 1
            continue
        if lowered in T.KEEP_TOKENS or T._stem(lowered) in T.KEEP_TOKENS:
            pieces.append((word.upper() if len(word) <= 5 else word, False))
            index += 1
            continue
        # 新行为：保留原文
        pieces.append((word, False))
        index += 1
    while pieces and pieces[0][1]:
        pieces.pop(0)
    while pieces and pieces[-1][1]:
        pieces.pop()
    joined = ''.join(c for c, _ in pieces)
    return re.sub(r'的的', '的', joined)

T._translate_words = _translate_words_keep

def groups_of(paths):
    total = 0; nodes = 0
    for p in sorted(paths):
        d = json.loads(p.read_text(encoding='utf-8'))
        by = collections.defaultdict(set)
        for n in d.get('nodes', []):
            by[n['name']].add(n.get('nameOriginal') or '')
        for name, origs in by.items():
            if len(origs) > 1:
                total += 1
                nodes += sum(1 for n in d['nodes'] if n['name'] == name)
    return total, nodes

print('BEFORE (current code):', groups_of(CONTENT.glob('*/toc.json')))
# 重算每个节点名
changed = 0; total = 0; samples = []
for p in sorted(CONTENT.glob('*/toc.json')):
    d = json.loads(p.read_text(encoding='utf-8'))
    for n in d.get('nodes', []):
        orig = n.get('nameOriginal') or ''
        if not orig:
            continue
        total += 1
        new = T.translate_title(T._normalize(orig)) or orig
        if new != n['name']:
            changed += 1
            if len(samples) < 12:
                samples.append((p.parent.name, n['name'], new, orig))
print(f'would change {changed}/{total} translated nodes')
for s in samples:
    print('  ', s[0], '|', s[1], '->', s[2], '  <=', s[3][:60])
