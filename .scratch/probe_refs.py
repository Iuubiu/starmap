import io
import json
import re
import sys

rows = [json.loads(l) for l in io.open('content/digital-kanghua-5e/chunks.jsonl', encoding='utf-8')]

# 书中对其它小节的显式引用：这是唯一能当先修边证据的东西
PATS = {
    'section': re.compile(r'第\s*([0-9]+(?:\.[0-9]+)*)\s*节'),
    'formula': re.compile(r'式\s*\(?\s*([0-9]+(?:\.[0-9]+){1,2})'),
    'chapter': re.compile(r'第\s*([0-9]+)\s*章'),
}
for name, pat in PATS.items():
    hits = [(r['printed_page'], r['micro_kp_id'], m.group(0)) for r in rows for m in [pat.search(r['text'])] if m]
    print(f'{name}: {len(hits)}')
    for h in hits[:5]:
        print('   ', h)
