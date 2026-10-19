import json, urllib.parse, urllib.request, time

DOIS = [
 "10.3102/00346543060002265",
 "10.1080/00220671.1988.10885824",
 "10.3102/00346543057002175",
 "10.4219/jaa-2007-704",
 "10.1037/a0037559",
 "10.3102/0034654316689306",
 "10.1177/0956797611417724",
 "10.1007/s10648-020-09572-8",
 "10.1037/bul0000209",
 "10.1037/edu0000001",
 "10.1007/s11251-007-9015-8",
 "10.1111/j.1467-9280.2008.02209.x",
 "10.1177/014662168200600408",
 "10.1016/b978-0-12-742780-5.50024-x",
 "10.1145/3636243.3636256",
 "10.1145/3501385.3543957",
 "10.1177/1529100612453266",
 "10.1037/a0023956",
 "10.1080/00461520.2011.611369",
 "10.1111/j.1745-3984.1984.tb01040.x",
 "10.1177/2372732215624708",
 "10.1037/0033-2909.132.3.354",
 "10.1126/science.1152408",
 "10.1177/014662168200600408",
]

def openalex(doi):
    url = "https://api.openalex.org/works/https://doi.org/" + doi
    req = urllib.request.Request(url, headers={"User-Agent": "refverify/1.0 (mailto:verify@example.org)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def abstract_from_inv(inv):
    if not inv: return None
    pos = {}
    for w, idxs in inv.items():
        for i in idxs: pos[i] = w
    return " ".join(pos[i] for i in sorted(pos))

for doi in DOIS:
    try:
        w = openalex(doi)
    except Exception as e:
        print("### ", doi, "ERR", e); continue
    print("###", doi)
    print("TITLE:", w.get("title"))
    print("YEAR:", w.get("publication_year"), "| VENUE:", (w.get("primary_location") or {}).get("source", {}) and ((w.get("primary_location") or {}).get("source") or {}).get("display_name"))
    ab = abstract_from_inv(w.get("abstract_inverted_index"))
    print("ABS:", (ab[:1600] if ab else "NONE"))
    print()
    time.sleep(0.15)
