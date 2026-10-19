import json, sys, urllib.parse, urllib.request, time

MAIL = "omnidev-research@example.com"
SEL = "id,doi,title,publication_year,abstract_inverted_index,cited_by_count,primary_location"

def recon(inv):
    if not inv:
        return ""
    pos = {}
    for w, idxs in inv.items():
        for i in idxs:
            pos[i] = w
    return " ".join(pos[i] for i in sorted(pos))

def get(doi):
    url = "https://api.openalex.org/works/doi:%s?select=%s&mailto=%s" % (urllib.parse.quote(doi), SEL, MAIL)
    req = urllib.request.Request(url, headers={"User-Agent": "lit-check/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

if __name__ == "__main__":
    dois = [l.strip() for l in open(sys.argv[1], encoding="utf-8") if l.strip() and not l.startswith("#")]
    out = []
    for d in dois:
        try:
            w = get(d)
            ab = recon(w.get("abstract_inverted_index"))
            out.append({"doi": d, "title": w.get("title"), "year": w.get("publication_year"),
                        "cites": w.get("cited_by_count"), "abstract": ab})
            print("=== %s | %s (%s) cites=%s" % (d, w.get("title"), w.get("publication_year"), w.get("cited_by_count")))
            print(ab[:1600] if ab else "(no abstract)")
            print()
        except Exception as e:
            print("ERR", d, e)
            print()
        time.sleep(0.15)
    json.dump(out, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
