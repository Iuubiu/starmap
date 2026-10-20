import io
import json
import re
from collections import Counter

rows = [json.loads(l) for l in io.open('content/digital-kanghua-5e/chunks.jsonl', encoding='utf-8')]

PATTERNS = {
    '第X章': r'第\s*(\d{1,2})\s*章',
    '第X节': r'第\s*(\d{1,2}(?:\.\d{1,2})*)\s*节',
    'X.Y节': r'(\d{1,2}(?:\.\d{1,2}){1,2})\s*节',
    '式(X.Y.Z)': r'式\s*[\(（]\s*(\d{1,2}(?:\.\d{1,2}){1,2})',
    '图X.Y.Z': r'图\s*(\d{1,2}(?:\.\d{1,2}){1,2})',
    '表X.Y.Z': r'表\s*(\d{1,2}(?:\.\d{1,2}){1,2})',
    '前面/前面所述': r'前面(?:所)?(?:介绍|讲|讨论|分析|提到)',
    '如X.Y所述': r'(?:如|见|参见)\s*(\d{1,2}(?:\.\d{1,2}){1,2})',
    '下一章/上一章': r'(?:下|上)一章',
    '将在X章': r'(?:将)?在\s*第?\s*(\d{1,2})\s*章',
}

for label, pat in PATTERNS.items():
    rx = re.compile(pat)
    hits = [m for r in rows for m in rx.finditer(r['text'])]
    pages = len({r['printed_page'] for r in rows if rx.search(r['text'])})
    print(f'{label:14} 命中 {len(hits):4}   出现在 {pages:3} 页   样例 {[m.group(0) for m in hits[:4]]}')
