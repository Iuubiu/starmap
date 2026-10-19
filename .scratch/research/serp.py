import sys, os, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import get
from urllib.parse import quote_plus

def serp(q, n=12):
    h = get("https://www.bing.com/search?q=" + quote_plus(q) + "&count=%d&setlang=en" % n).decode("utf-8", "replace")
    # results are <li class="b_algo"> ... <h2><a href="URL">TITLE</a></h2> ... <p>SNIPPET</p>
    out = []
    for m in re.finditer(r'<li class="b_algo".*?</li>', h, re.S):
        blk = m.group(0)
        u = re.search(r'<h2[^>]*>\s*<a[^>]*href="(https?://[^"]+)"', blk)
        t = re.search(r'<h2[^>]*>(.*?)</h2>', blk, re.S)
        p = re.search(r'<p[^>]*>(.*?)</p>', blk, re.S)
        def clean(s):
            if not s: return ""
            s = re.sub(r"<[^>]+>", "", s)
            s = s.replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", '"').replace("&nbsp;", " ")
            return re.sub(r"\s+", " ", s).strip()
        if u:
            out.append((clean(t.group(1) if t else ""), u.group(1), clean(p.group(1) if p else "")))
    return out

if __name__ == "__main__":
    for q in sys.argv[1:]:
        print("######", q)
        for t, u, s in serp(q):
            print(f"- {t}\n  {u}\n  {s[:220]}")
        print()
