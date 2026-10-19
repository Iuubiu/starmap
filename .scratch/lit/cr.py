import sys, json, re, urllib.request, time

def get(doi):
    url = "https://api.crossref.org/works/" + urllib.parse.quote(doi)
    req = urllib.request.Request(url, headers={"User-Agent": "lit-review/1.0 (mailto:research@example.org)"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)["message"]

def clean(t):
    t = re.sub(r"<[^>]+>", " ", t or "")
    t = re.sub(r"\s+", " ", t)
    return t.strip()

for line in open(sys.argv[1], encoding="utf-8"):
    doi = line.strip()
    if not doi: continue
    try:
        m = get(doi)
    except Exception as e:
        print("ERR", doi, e); time.sleep(1); continue
    title = clean((m.get("title") or [""])[0])
    year = (m.get("issued", {}).get("date-parts") or [[None]])[0][0]
    print("===", doi, "|", year, "|", title)
    ab = clean(m.get("abstract", ""))
    print(ab[:1800] if ab else "(no abstract)")
    print()
    time.sleep(0.6)
