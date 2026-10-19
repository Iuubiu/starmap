import sys, os, re, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import get, text_of, save
from urllib.parse import quote_plus, unquote, urlparse, parse_qs

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

def ddg(q):
    h = get("https://html.duckduckgo.com/html/?q=" + quote_plus(q)).decode("utf-8", "replace")
    out = []
    for m in re.finditer(r'<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>(.*?)</a>', h, re.S):
        href, title = m.group(1), m.group(2)
        if "uddg=" in href:
            href = unquote(parse_qs(urlparse(href).query)["uddg"][0])
        title = re.sub(r"<[^>]+>", "", title).replace("&#x27;", "'").replace("&amp;", "&").strip()
        out.append((title, href))
    # snippets
    snips = [re.sub(r"<[^>]+>", "", s).strip() for s in re.findall(r'class="result__snippet"[^>]*>(.*?)</a>', h, re.S)]
    res = []
    for i, (t, u) in enumerate(out):
        res.append({"title": t, "url": u, "snippet": snips[i] if i < len(snips) else ""})
    return res

if __name__ == "__main__":
    q = " ".join(sys.argv[1:])
    for r in ddg(q):
        print(f"- {r['title']}\n  {r['url']}\n  {r['snippet'][:250]}")
