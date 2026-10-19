import sys, os, json, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import get

def cr(query, rows=6, filt=""):
    u = "https://api.crossref.org/works?rows=%d&query=%s&select=title,DOI,abstract,container-title,issued,author,is-referenced-by-count" % (rows, urllib.parse.quote(query))
    if filt:
        u += "&filter=" + filt
    r = get(u)
    try:
        d = json.loads(r)
    except Exception:
        return []
    out = []
    for it in d["message"]["items"]:
        out.append({
            "title": (it.get("title") or [""])[0],
            "journal": (it.get("container-title") or [""])[0],
            "year": (it.get("issued", {}).get("date-parts") or [[None]])[0][0],
            "cites": it.get("is-referenced-by-count"),
            "doi": it.get("DOI"),
            "abstract": (it.get("abstract") or "")[:600],
        })
    return out

if __name__ == "__main__":
    for q in sys.argv[1:]:
        print("######", q)
        for r in cr(q, rows=5):
            print(f'- [{r["year"]}] {r["title"][:120]} | {r["journal"][:45]} | cites={r["cites"]} | {r["doi"]}')
            if r["abstract"]:
                print("   ABS:", r["abstract"][:300].replace("\n", " "))
        print()
