import json, sys, time, urllib.request, urllib.parse

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent':'lit-review/1.0 (mailto:user@example.com)'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode('utf-8','replace'))

for doi in [l.strip() for l in open(sys.argv[1],encoding='utf-8') if l.strip()]:
    try:
        d = get('https://api.openalex.org/works/doi:' + doi + '?select=id,doi,title,publication_year,cited_by_count,abstract_inverted_index,primary_location')
    except Exception as e:
        print('===', doi, 'ERR', e); continue
    ab = d.get('abstract_inverted_index')
    text = ''
    if ab:
        pos = []
        for w, idxs in ab.items():
            for i in idxs: pos.append((i,w))
        text = ' '.join(w for i,w in sorted(pos))
    src = (d.get('primary_location') or {}).get('source') or {}
    print('===', d.get('doi'), '|', d.get('publication_year'), '| cites', d.get('cited_by_count'), '|', src.get('display_name'))
    print(d.get('title'))
    print(text if text else '(no abstract)')
    print()
    time.sleep(0.4)
