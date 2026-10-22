import json, sys
sys.path.insert(0,'tools/ingest')
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from extract import _looks_like_formula
from pathlib import Path
for book in ['debertin-1988','tsoulfanidis-4e','leo-2e','lutz-2007','knoll-3e-2000','knoll-4e-2010','gilmore-2e-2008']:
    f=Path('content')/book/'chunks.jsonl'
    for line in f.read_text(encoding='utf-8').splitlines():
        c=json.loads(line); t=c.get('text') or ''
        ar=sum(1 for ch in t if ch.isascii() and ch.isalpha())/max(1,len(t))
        if c.get('kind')=='formula' and len(t)>200 and ar>0.55:
            print(book, c['id'], 'len=',len(t), 'ar=',round(ar,2),
                  'looks=', _looks_like_formula(t, 9.0), 'ans=', bool(c.get('answer_for')))
