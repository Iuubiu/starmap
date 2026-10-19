import json, sys, time, urllib.request, urllib.parse

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent':'lit-review/1.0 (mailto:user@example.com)'})
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read().decode('utf-8','replace'))

q = sys.argv[1]
url = 'https://api.openalex.org/works?search=' + urllib.parse.quote(q) + '&per-page=10&select=doi,title,publication_year,cited_by_count,abstract_inverted_index'
try:
    d = get(url)
except Exception as e:
    print('ERR', e); raise SystemExit
for w in d.get('results', []):
    ab = w.get('abstract_inverted_index')
    txt = ''
    if ab:
        pos=[]
        for word, idxs in ab.items():
            for i in idxs: pos.append((i,word))
        txt=' '.join(x for _,x in sorted(pos))
    print('===', w.get('doi'), '|', w.get('publication_year'), '| cites', w.get('cited_by_count'))
    print(w.get('title'))
    print(txt[:600] if txt else '(no abstract)')
    print()
