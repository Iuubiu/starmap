import io
import json
import sys

sys.path.insert(0, 'tools/ingest')
from assign import _core_terms, leaf_page_ranges, owner_of

STRICT = ('称为', '叫做', '定义为', '是指', '可表示为')
LOOSE = STRICT + ('表达式', '即')

toc = json.load(io.open('content/digital-kanghua-5e/toc.json', encoding='utf-8'))['nodes']
rows = [json.loads(l) for l in io.open('content/digital-kanghua-5e/chunks.jsonl', encoding='utf-8')]
ranges = leaf_page_ranges(toc)
names = {n['microKpId']: n['name'] for n in toc}


def count(markers):
    hits = []
    for r in rows:
        if r['kind'] != 'text':
            continue
        o = owner_of(r['printed_page'], ranges)
        if not o:
            continue
        terms = _core_terms(names[o[0]])
        if any(t in r['text'] for t in terms) and any(m in r['text'] for m in markers):
            hits.append(r)
    return hits


for label, markers in (('STRICT', STRICT), ('LOOSE', LOOSE)):
    h = count(markers)
    print(f'{label}: {len(h)} text answer blocks')

le = count(LOOSE)
st = count(STRICT)
extra = [r for r in le if r not in st]
print(f'\n仅 LOOSE 命中（即只靠「表达式」/「即」的）: {len(extra)}')
for r in extra[:8]:
    print(f"p{r['printed_page']} | {r['text'][:90]}")
