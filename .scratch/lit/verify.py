import json, sys, time, urllib.request, urllib.error

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent':'lit-review/1.0 (mailto:user@example.com)'})
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read().decode('utf-8','replace'))

bad = []
for doi in [l.strip() for l in open(sys.argv[1],encoding='utf-8') if l.strip()]:
    try:
        d = get('https://api.crossref.org/works/' + doi)['message']
        t = (d.get('title') or ['(no title)'])[0]
        y = (d.get('issued',{}).get('date-parts') or [[None]])[0][0]
        ct = (d.get('container-title') or [''])[0]
        print('OK  ', doi, '|', y, '|', t[:70], '|', ct[:40])
    except Exception as e:
        bad.append(doi)
        print('FAIL', doi, e)
    time.sleep(0.15)

print()
print('TOTAL FAIL:', len(bad))
for b in bad: print('  ', b)
