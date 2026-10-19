import sys, json, time, urllib.request, urllib.parse, re

QUERIES_FILE = sys.argv[1]
MAIL = "litreview@example.org"

def restore(inv):
    if not inv:
        return ""
    pos = {}
    for w, idxs in inv.items():
        for i in idxs:
            pos[i] = w
    return " ".join(pos[i] for i in sorted(pos))

def search(q, per=8):
    url = ("https://api.openalex.org/works?search=" + urllib.parse.quote(q) +
           "&per-page=%d&mailto=%s" % (per, MAIL))
    req = urllib.request.Request(url, headers={"User-Agent": "lit-review/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r).get("results", [])

for line in open(QUERIES_FILE, encoding="utf-8"):
    q = line.strip()
    if not q:
        continue
    print("######", q)
    try:
        res = search(q)
    except Exception as e:
        print("  ERR", e)
        time.sleep(2)
        continue
    for w in res:
        doi = (w.get("doi") or "").replace("https://doi.org/", "")
        au = ", ".join(a["author"]["display_name"] for a in w.get("authorships", [])[:3])
        src = ((w.get("primary_location") or {}).get("source") or {}).get("display_name") or ""
        print("  %s | %s | %s | %s | %s | cites=%s" %
              (w.get("publication_year"), au, (w.get("title") or "")[:120], src[:45], doi, w.get("cited_by_count")))
    time.sleep(1)
