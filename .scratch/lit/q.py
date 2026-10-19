import json, sys, urllib.parse, urllib.request, time

MAIL = "omnidev-research@example.com"

def q(query, rows=3):
    url = ("https://api.crossref.org/works?rows=%d&select=DOI,title,container-title,issued,author,type,volume,page&mailto=%s&query.bibliographic=%s"
           % (rows, MAIL, urllib.parse.quote(query)))
    req = urllib.request.Request(url, headers={"User-Agent": "omnidev-lit-check/1.0 (mailto:%s)" % MAIL})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    out = []
    for it in data["message"]["items"]:
        title = (it.get("title") or [""])[0]
        cont = (it.get("container-title") or [""])
        cont = cont[0] if cont else ""
        yr = it.get("issued", {}).get("date-parts", [[None]])[0][0]
        auth = it.get("author", []) or []
        names = ", ".join((a.get("family") or "") for a in auth[:4])
        out.append({"doi": it.get("DOI"), "title": title, "journal": cont, "year": yr,
                    "authors": names, "vol": it.get("volume"), "page": it.get("page")})
    return out

if __name__ == "__main__":
    lines = [l.strip() for l in open(sys.argv[1], encoding="utf-8") if l.strip()]
    for l in lines:
        print("### " + l)
        try:
            for r in q(l):
                print("  %s | %s | %s | %s | %s | v%s p%s" % (r["year"], r["authors"], r["title"][:110], r["journal"][:60], r["doi"], r["vol"], r["page"]))
        except Exception as e:
            print("  ERR", e)
        time.sleep(0.4)
