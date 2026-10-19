import sys, os, re, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import get
from urllib.parse import quote_plus

def search(q, kind="repositories", n=20):
    url = f"https://github.com/search?q={quote_plus(q)}&type={kind}&s=stars&o=desc"
    h = get(url).decode("utf-8", "replace")
    i = h.find('{"payload":{"blackbirdSearchRoute"')
    if i < 0:
        return []
    # balance braces from i
    depth = 0
    for j in range(i, len(h)):
        if h[j] == '{':
            depth += 1
        elif h[j] == '}':
            depth -= 1
            if depth == 0:
                blob = h[i:j+1]
                break
    else:
        return []
    try:
        data = json.loads(blob)
    except Exception as e:
        return [("PARSE_ERR", str(e))]
    res = data["payload"]["blackbirdSearchRoute"].get("results", [])
    out = []
    for r in res[:n]:
        desc = re.sub(r"</?em>", "", r.get("hl_trunc_description") or "")
        out.append({
            "repo": r.get("hl_name"),
            "stars": r.get("followers"),
            "lang": r.get("language"),
            "desc": desc,
        })
    return out

if __name__ == "__main__":
    for q in sys.argv[1:]:
        print("######", q)
        for r in search(q):
            print(f'{r["stars"]:>7}  {r["repo"]:<45} {str(r["lang"]):<12} {r["desc"][:110]}')
