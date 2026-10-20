import io
import json
import re

toc = json.load(io.open('content/digital-kanghua-5e/toc.json', encoding='utf-8'))['nodes']
nums = [n.get('num') for n in toc if n.get('num')]
print('sample nums', nums[:12])
print('repr of one', [repr(x) for x in nums[:6]])

rows = [json.loads(l) for l in io.open('content/digital-kanghua-5e/chunks.jsonl', encoding='utf-8')]
SECTION = re.compile(r'(\d{1,2}(?:\.\d{1,2}){1,2})\s*节')
found = []
for r in rows:
    for m in SECTION.finditer(r['text']):
        found.append((m.group(0), repr(r['text'][m.start() - 6:m.end() + 4])))
print('hits', len(found))
for f in found[:6]:
    print(f)
