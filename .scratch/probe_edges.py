import io
import json
import re
from collections import defaultdict

toc = json.load(io.open('content/digital-kanghua-5e/toc.json', encoding='utf-8'))['nodes']
rows = [json.loads(l) for l in io.open('content/digital-kanghua-5e/chunks.jsonl', encoding='utf-8')]

page_of = {n['microKpId']: n['printedPage'] for n in toc}
num_to_id = {n['num']: n['microKpId'] for n in toc if n.get('num')}
# 节号 -> 其下所有叶子
leaves_of = defaultdict(list)
for n in toc:
    if not n['isLeaf']:
        continue
    anc = n['microKpId']
    # 用 num 前缀匹配
    num = n.get('num') or ''
    parts = num.split('.')
    for k in range(1, len(parts) + 1):
        leaves_of['.'.join(parts[:k])].append(anc)

print('num_to_id', len(num_to_id), 'leaves_of keys', len(leaves_of))

SECTION = re.compile(r'第\s*(\d+)\s*节')
FORMULA = re.compile(r'式\s*[\(（]\s*(\d+(?:\.\d+){1,2})')
CHAPTER = re.compile(r'第\s*(\d+)\s*章')

edges = defaultdict(list)
unresolved = defaultdict(int)

for r in rows:
    owner = r.get('micro_kp_id')
    if not owner:
        continue
    text = r['text']
    own_page = r['printed_page']

    for m in SECTION.finditer(text):
        target_num = m.group(1)
        tgt = num_to_id.get(target_num)
        if not tgt:
            # 章号当节号用（"第 1 节" 常见于章内）
            unresolved['section'] += 1
            continue
        if page_of.get(tgt, 0) >= own_page:
            continue
        for leaf in leaves_of.get(target_num, []):
            edges[(leaf, owner)].append(('节', m.group(0), own_page))

    for m in FORMULA.finditer(text):
        target_num = m.group(1)
        if target_num not in num_to_id:
            unresolved['formula'] += 1
            continue
        if page_of.get(target_num, 10**6) >= own_page:
            continue
        for leaf in leaves_of.get(target_num, []):
            edges[(leaf, owner)].append(('式', m.group(0), own_page))

    for m in CHAPTER.finditer(text):
        ch = m.group(1)
        if not ch:
            unresolved['chapter'] += 1
            continue
        if page_of.get(ch, 10**6) >= own_page:
            continue
        for leaf in leaves_of.get(ch, []):
            edges[(leaf, own_page and owner)].append(('章', m.group(0), own_page))

print('candidate edges', len(edges))
print('unresolved', dict(unresolved))
chaps = {n['microKpId']: n['num'] for n in toc if n['depth'] == 1}
src_ch = defaultdict(int)
for (a, b) in edges:
    src_ch[(chaps.get(a), chaps.get(b))] += 1
for k in sorted(src_ch, key=lambda x: (str(x[0]), str(x[1]))):
    if k[0] != k[1]:
        print('  跨章', k, src_ch[k])
