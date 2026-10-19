import json, sys, time, urllib.request

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent':'lit-review/1.0'})
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read().decode('utf-8','replace'))

for doi in ['10.1037/0003-066x.34.4.307','10.3102/0091732x004001003','10.1037/0021-9010.84.5.795']:
    for base in ['https://api.semanticscholar.org/graph/v1/paper/DOI:']:
        try:
            d = get(base + doi + '?fields=title,year,abstract,venue,citationCount')
            print('===', doi, '|', d.get('year'), '| cites', d.get('citationCount'), '|', d.get('venue'))
            print(d.get('title'))
            print(d.get('abstract') or '(no abstract)')
            print()
        except Exception as e:
            print('===', doi, 'ERR', e)
    time.sleep(3)
