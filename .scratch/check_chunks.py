"""体检：全量 chunk 里还有多少「表格碎片混进正文」与异常 table 结构。"""
import json
import re
from collections import Counter
from pathlib import Path

path = Path('content/digital-kanghua-5e/chunks.jsonl')
chunks = [json.loads(line) for line in path.open(encoding='utf-8')]

print('总数', len(chunks), Counter(c['kind'] for c in chunks))

# 1) 像表格碎片：去空白后 >85% 是 0/1 或单字符、无中文
susp = []
for c in chunks:
    if c['kind'] != 'text':
        continue
    t = re.sub(r'\s+', '', c['text'])
    if len(t) < 10 or len(t) > 260:
        continue
    if re.search(r'[\u4e00-\u9fff]', t):
        continue
    binary = sum(1 for ch in t if ch in '01')
    if binary / len(t) > 0.85:
        susp.append(c)
print(f'\n疑似二进制表碎片（text）: {len(susp)}')
for c in susp[:12]:
    print(f"  p{c['printed_page']:>3} {c['text'][:70]!r}")

# 2) table chunk 的行列分布
shapes = Counter()
for c in chunks:
    if c['kind'] == 'table':
        rows = c.get('rows') or []
        shapes[(len(rows), len(rows[0]) if rows else 0)] += 1
print(f'\ntable chunk {sum(shapes.values())} 个，形状分布（前 12）:')
for (r, col), n in shapes.most_common(12):
    print(f'   {r:>2} 行 × {col:>2} 列  ×{n}')

# 3) 单行或极瘦的 table
thin = [c for c in chunks if c['kind'] == 'table' and len(c.get('rows') or []) < 3]
print(f'\n<3 行的 table chunk: {len(thin)}')
for c in thin[:8]:
    print(f"  p{c['printed_page']} rows={c.get('rows')}")

# 4) 空内容 chunk
empty = [c for c in chunks if not c['text'].strip()]
print(f'\n空文本 chunk: {len(empty)}')
